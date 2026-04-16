import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAGE1_PROMPT = `너는 10년차 시니어 미들웨어 엔지니어야. 사용자가 대용량 로그에서 필터링된 요약 데이터를 제공한다.

네 역할:
1. 제공된 에러/경고 요약과 의심 구간 정보를 분석
2. 각 의심 구간의 위험도를 평가
3. 상세 분석이 필요한 구간을 우선순위로 정렬하여 반환

반드시 JSON만 반환해.`;

const STAGE2_PROMPT = `너는 10년차 시니어 미들웨어 엔지니어야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.

1차 분석에서 의심 구간으로 특정된 상세 로그(전후 100줄)를 제공한다.
각 구간별로 최종 장애 원인을 분석하고 조치 가이드를 제시해.

분석 시 특히 주의할 패턴:
- OutOfMemoryError, GC overhead limit exceeded → 메모리 누수
- abnormal closed, connection reset → 비정상 세션 종료
- not closed, connection pool → 커넥션 풀 이슈
- Thread pool exceeded → 스레드 풀 포화
- timeout → 타임아웃
- Full GC, STW → GC 관련 장애

과거 유사 장애 사례가 제공되면, 해당 사례의 조치 경험을 참고하여 더 정확한 분석과 권장 조치를 제공해.

반드시 JSON만 반환해.`;

const stage1Tools = [
  {
    type: "function",
    function: {
      name: "identify_suspect_intervals",
      description: "Identify and prioritize suspect time intervals from filtered log summary",
      parameters: {
        type: "object",
        properties: {
          suspectIntervals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                intervalIndex: { type: "number", description: "Index of the interval from the input" },
                priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                reason: { type: "string", description: "Why this interval is suspicious (Korean)" },
                timeRange: { type: "string" },
              },
              required: ["intervalIndex", "priority", "reason", "timeRange"],
              additionalProperties: false,
            },
          },
          overallAssessment: { type: "string", description: "Overall system health assessment (Korean)" },
        },
        required: ["suspectIntervals", "overallAssessment"],
        additionalProperties: false,
      },
    },
  },
];

const stage2Tools = [
  {
    type: "function",
    function: {
      name: "log_analysis_result",
      description: "Return structured log analysis results for suspect intervals",
      parameters: {
        type: "object",
        properties: {
          analyses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["critical", "warning", "info"] },
                title: { type: "string" },
                cause: { type: "string" },
                recommendation: { type: "string" },
                impact: { type: "string" },
                relatedLines: { type: "array", items: { type: "number" } },
                timeRange: { type: "string" },
              },
              required: ["severity", "title", "cause", "recommendation", "impact", "relatedLines"],
              additionalProperties: false,
            },
          },
          stats: {
            type: "object",
            properties: {
              critical: { type: "number" },
              warning: { type: "number" },
              info: { type: "number" },
              totalLines: { type: "number" },
            },
            required: ["critical", "warning", "info", "totalLines"],
            additionalProperties: false,
          },
        },
        required: ["analyses", "stats"],
        additionalProperties: false,
      },
    },
  },
];

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.data?.[0]?.embedding) return data.data[0].embedding;
    }
  } catch { /* ignore */ }

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Output ONLY a JSON array of exactly 1536 floats between -1 and 1 representing the semantic meaning of the text. Focus on: error type, severity, middleware, root cause. No other text.",
          },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]).slice(0, 1536).map((n: any) => Number(n) || 0);
      while (arr.length < 1536) arr.push(0);
      return arr;
    }
  } catch { /* ignore */ }

  return null;
}

async function findSimilarCases(logText: string, apiKey: string): Promise<string> {
  try {
    const embedding = await generateEmbedding(logText, apiKey);
    if (!embedding) return "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("match_logs", {
      query_embedding: `[${embedding.join(",")}]`,
      match_threshold: 0.5,
      match_count: 3,
    });

    if (error || !data || data.length === 0) return "";

    const cases = data.map((d: any, i: number) =>
      `[과거 사례 ${i + 1}] (유사도: ${(d.similarity * 100).toFixed(1)}%)\n${d.content}`
    ).join("\n\n");

    return `\n\n--- 유사한 과거 장애 사례 ---\n${cases}\n\n위 과거 사례를 참고하여, 이전 조치 경험을 반영한 분석과 권장 조치를 제공해줘.`;
  } catch (e) {
    console.error("Similar case lookup failed:", e);
    return "";
  }
}

async function callAI(apiKey: string, systemPrompt: string, userContent: string, tools: any[], toolName: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools,
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw { status: 429, message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요." };
    if (response.status === 402) throw { status: 402, message: "크레딧이 부족합니다." };
    const t = await response.text();
    console.error("AI error:", response.status, t);
    throw { status: 500, message: "AI gateway error" };
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }

  const content = data.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);

  throw { status: 500, message: "Could not parse AI response" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { stage } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw { status: 500, message: "LOVABLE_API_KEY not configured" };

    if (stage === 1) {
      const { summary, intervals } = body;
      if (!summary || !intervals) {
        return new Response(JSON.stringify({ error: "summary and intervals required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userContent = `다음은 대용량 로그 파일에서 필터링된 요약 정보야:\n\n${summary}\n\n의심 구간 목록:\n${
        intervals.map((iv: any, i: number) =>
          `[구간 ${i}] 시간: ${iv.start} ~ ${iv.end}, 에러 ${iv.errorCount}건, 샘플:\n${
            iv.lines.slice(0, 20).map((l: any) => `  L${l.lineNumber}: ${l.text}`).join('\n')
          }`
        ).join('\n\n')
      }`;

      const result = await callAI(LOVABLE_API_KEY, STAGE1_PROMPT, userContent, stage1Tools, "identify_suspect_intervals");
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (stage === 2) {
      const { detailedLogs, totalLines } = body;
      if (!detailedLogs) {
        return new Response(JSON.stringify({ error: "detailedLogs required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find similar past cases based on the detailed logs
      const similarCases = await findSimilarCases(detailedLogs.slice(0, 2000), LOVABLE_API_KEY);

      const userContent = `다음은 1차 분석에서 의심 구간으로 특정된 상세 로그(전후 100줄)야. 총 원본 라인 수: ${totalLines}\n\n${detailedLogs}${similarCases}`;

      const result = await callAI(LOVABLE_API_KEY, STAGE2_PROMPT, userContent, stage2Tools, "log_analysis_result");
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else {
      return new Response(JSON.stringify({ error: "stage must be 1 or 2" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e: any) {
    const status = e.status || 500;
    const message = e.message || "Unknown error";
    console.error("analyze-log-v2 error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
