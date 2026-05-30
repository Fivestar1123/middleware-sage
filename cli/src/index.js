#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const program = new Command();

const CONFIG = {
  OLLAMA_URL: process.env.LOGMIND_OLLAMA_URL || 'http://192.168.28.1:11434',
  OLLAMA_MODEL: process.env.LOGMIND_MODEL || 'qwen2.5:3b',
  KLUE_URL: process.env.LOGMIND_KLUE_URL || 'http://192.168.28.128:8002',
  ANOMALY_URL: process.env.LOGMIND_ANOMALY_URL || 'http://192.168.28.128:8003',
  QDRANT_URL: process.env.LOGMIND_QDRANT_URL || 'http://192.168.28.128:6333',
  KRSBERT_URL: process.env.LOGMIND_KRSBERT_URL || 'http://192.168.28.128:8001',
};

// ── 유틸 함수 ──────────────────────────────────────────

function printBanner() {
  console.log(chalk.bold.blue('\n╔═══════════════════════════════╗'));
  console.log(chalk.bold.blue('║') + chalk.bold.white('   LogMind CLI v1.0.0          ') + chalk.bold.blue('║'));
  console.log(chalk.bold.blue('║') + chalk.gray('   AI 미들웨어 로그 분석 도구   ') + chalk.bold.blue('║'));
  console.log(chalk.bold.blue('╚═══════════════════════════════╝\n'));
}

function severityColor(severity) {
  switch (severity) {
    case 'critical': return chalk.red.bold(severity.toUpperCase());
    case 'warning': return chalk.yellow(severity.toUpperCase());
    default: return chalk.blue(severity.toUpperCase());
  }
}

// ── 로그 필터링 ──────────────────────────────────────────

async function filterLog(filePath, maxLines = 500) {
  const CRITICAL_RE = /\b(FATAL|CRITICAL|PANIC|ERROR|EXCEPTION|FAIL(ED|URE)?|SEVERE)\b/i;
  const WARNING_RE = /\b(WARN(ING)?|DEPRECATED|RETRY|TIMEOUT|EXCEEDED)\b/i;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const allLines = [];
  const filteredLines = [];
  let lineNum = 0;
  const stats = { critical: 0, warning: 0, info: 0, total: 0 };

  for await (const line of rl) {
    lineNum++;
    allLines.push(line);
    stats.total++;

    if (CRITICAL_RE.test(line)) {
      filteredLines.push({ num: lineNum, text: line, severity: 'critical' });
      stats.critical++;
    } else if (WARNING_RE.test(line)) {
      filteredLines.push({ num: lineNum, text: line, severity: 'warning' });
      stats.warning++;
    } else {
      stats.info++;
    }
  }

  return {
    filteredLines: filteredLines.slice(0, maxLines),
    stats,
    totalLines: lineNum,
  };
}

// ── KLUE 도메인 분류 ──────────────────────────────────────────

async function classifyDomain(texts) {
  try {
    const res = await fetch(`${CONFIG.KLUE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: texts.slice(0, 10) }),
    });
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

// ── Ollama 분석 ──────────────────────────────────────────

async function analyzeWithOllama(logContent, domainContext = '') {
  const systemPrompt = `너는 LogMind야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.
반드시 아래 JSON 형식만 반환해:
{
  "analyses": [
    {
      "severity": "critical",
      "title": "제목",
      "cause": "원인",
      "recommendation": "권장조치",
      "impact": "영향범위",
      "relatedLines": [1, 2, 3]
    }
  ]
}`;

  const userContent = `다음 로그를 분석해줘:${domainContext}\n\n${logContent.slice(0, 5000)}`;

  const res = await fetch(`${CONFIG.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CONFIG.OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 4096 },
    }),
  });

  const data = await res.json();
  const content = data.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Ollama 응답 파싱 실패');
}

// ── 결과 출력 ──────────────────────────────────────────

function printResults(result, stats, domain, outputPath) {
  console.log(chalk.bold('\n📊 분석 통계'));
  console.log(`  총 라인: ${chalk.white(stats.total.toLocaleString())}줄`);
  console.log(`  Critical: ${chalk.red.bold(stats.critical.toLocaleString())}건`);
  console.log(`  Warning:  ${chalk.yellow(stats.warning.toLocaleString())}건`);
  console.log(`  Info:     ${chalk.blue(stats.info.toLocaleString())}건`);

  if (domain) {
    console.log(`  도메인:   ${chalk.cyan(domain.toUpperCase())}`);
  }

  console.log(chalk.bold('\n🔍 AI 분석 결과'));

  if (!result.analyses || result.analyses.length === 0) {
    console.log(chalk.green('  ✅ 이상 없음'));
    return;
  }

  result.analyses.forEach((a, i) => {
    console.log(`\n  ${chalk.bold(`[${i + 1}]`)} ${severityColor(a.severity)} — ${chalk.white.bold(a.title)}`);
    console.log(`  ${chalk.gray('원인:')}     ${a.cause}`);
    console.log(`  ${chalk.gray('권장조치:')} ${a.recommendation}`);
    console.log(`  ${chalk.gray('영향범위:')} ${a.impact}`);
    if (a.relatedLines?.length > 0) {
      console.log(`  ${chalk.gray('관련라인:')} L${a.relatedLines.join(', L')}`);
    }
  });

  if (outputPath) {
    const output = {
      timestamp: new Date().toISOString(),
      stats,
      domain,
      analyses: result.analyses,
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(chalk.green(`\n💾 결과 저장: ${outputPath}`));
  }
}

// ── analyze 커맨드 ──────────────────────────────────────────

program
  .name('logmind')
  .description('AI 기반 미들웨어 로그 분석 CLI')
  .version('1.0.0');

program
  .command('analyze <logfile>')
  .description('로그 파일 AI 분석')
  .option('-m, --model <model>', 'Ollama 모델', 'qwen2.5:3b')
  .option('-o, --output <file>', '결과 저장 경로 (JSON)')
  .option('-d, --domain <domain>', '도메인 힌트 (was/web/jvm/db)')
  .option('--max-lines <n>', '최대 분석 라인 수', '500')
  .action(async (logfile, options) => {
    printBanner();

    // 파일 존재 확인
    if (!fs.existsSync(logfile)) {
      console.error(chalk.red(`❌ 파일을 찾을 수 없습니다: ${logfile}`));
      process.exit(1);
    }

    const fileStat = fs.statSync(logfile);
    const fileSizeMB = (fileStat.size / 1024 / 1024).toFixed(2);
    console.log(chalk.gray(`📁 파일: ${path.resolve(logfile)} (${fileSizeMB}MB)\n`));

    // 1. 로그 필터링
    const spinner1 = ora('로그 필터링 중...').start();
    const { filteredLines, stats, totalLines } = await filterLog(logfile, parseInt(options.maxLines));
    spinner1.succeed(`필터링 완료 — ${totalLines.toLocaleString()}줄 중 ${filteredLines.length}개 추출`);

    if (filteredLines.length === 0) {
      console.log(chalk.green('\n✅ 이상 로그가 감지되지 않았습니다.'));
      process.exit(0);
    }

    // 2. KLUE 도메인 분류
    const spinner2 = ora('도메인 분류 중...').start();
    const sampleTexts = filteredLines.slice(0, 10).map(l => l.text);
    const classifications = await classifyDomain(sampleTexts);
    const domainCounts = {};
    for (const c of classifications) {
      if (c.domain !== 'general') {
        domainCounts[c.domain] = (domainCounts[c.domain] || 0) + 1;
      }
    }
    const topDomain = options.domain ||
      (Object.keys(domainCounts).length > 0
        ? Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0][0]
        : 'general');
    spinner2.succeed(`도메인 분류 완료 — ${topDomain.toUpperCase()}`);

    // 3. Ollama 분석
    const spinner3 = ora(`Ollama (${options.model}) 분석 중...`).start();
    const logContent = filteredLines
      .map(l => `L${l.num} [${l.severity.toUpperCase()}]: ${l.text}`)
      .join('\n');
    const domainContext = topDomain !== 'general'
      ? `\n\n[도메인: ${topDomain.toUpperCase()} 시스템 로그]`
      : '';

    const result = await analyzeWithOllama(logContent, domainContext);
    spinner3.succeed('AI 분석 완료');

    // 4. 결과 출력
    printResults(result, stats, topDomain, options.output);
    console.log();
  });

// ── status 커맨드 ──────────────────────────────────────────

program
  .command('status')
  .description('LogMind 서비스 상태 확인')
  .action(async () => {
    printBanner();
    console.log(chalk.bold('🔌 서비스 상태 확인\n'));

    const services = [
      { name: 'Ollama (LLM)', url: `${CONFIG.OLLAMA_URL}/api/tags` },
      { name: 'KR-SBERT', url: `${CONFIG.KRSBERT_URL}/health` },
      { name: 'KLUE-RoBERTa', url: `${CONFIG.KLUE_URL}/health` },
      { name: 'Anomaly Detection', url: `${CONFIG.ANOMALY_URL}/health` },
      { name: 'Qdrant', url: `${CONFIG.QDRANT_URL}/collections` },
    ];

    for (const svc of services) {
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          console.log(`  ${chalk.green('✅')} ${chalk.white(svc.name)}`);
        } else {
          console.log(`  ${chalk.red('❌')} ${chalk.white(svc.name)} (HTTP ${res.status})`);
        }
      } catch {
        console.log(`  ${chalk.red('❌')} ${chalk.white(svc.name)} (연결 실패)`);
      }
    }
    console.log();
  });

program.parse();
