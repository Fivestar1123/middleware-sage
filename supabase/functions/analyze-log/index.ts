import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `너는 10년차 시니어 미들웨어 엔지니어야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.

사용자가 로그를 제공하면 다음 JSON 형식으로 분석 결과를 반환해:

{
  "analyses": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "장애 제목 (한글)",
      "cause": "장애 원인 추정 (상세하게, 한글)",
      "recommendation": "권장 조치 가이드 (번호 매기기, 한글)",
      "impact": "예상 영향 범위 (한글)",
      "relatedLines": [관련 라인 번호 배열]
    }
  ],
  "stats": {
    "critical": 에러 수,
    "warning": 경고 수,
    "info": 정보 수,
    "totalLines": 총 라인 수
  }
}

분석 시 특히 주의할 패턴:
- OutOfMemoryError, GC overhead limit exceeded → 메모리 누수
- abnormal closed, connection reset → 비정상 세션 종료
- not closed, connection pool → 커넥션 풀 이슈
- Thread pool exceeded → 스레드 풀 포화
- timeout → 타임아웃
- Full GC, STW → GC 관련 장애

과거 유사 장애 사례가 제공되면, 해당 사례의 조치 경험을 참고하여 더 정확한 분석과 권장 조치를 제공해.

반드시 JSON만 반환해. 다른 텍스트 없이.`;

const analysisTools = [
  {
    type: "function",
    function: {
      name: "log_analysis_result",
      description: "Return structured log analysis results",
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

function generateEmbedding(text: string): number[] | null {
  const DIM = 1536;
  const vec = new Float64Array(DIM);
  const lower = text.toLowerCase();

  const keywords: Record<string, number[]> = {
    "outofmemoryerror": [0,1,2,3], "oom": [0,1,4], "heap": [0,5,6], "gc overhead": [0,7,8],
    "full gc": [9,10,11], "stw": [9,12], "메모리": [0,1,13], "memory": [0,1,14],
    "connection reset": [20,21,22], "abnormal closed": [20,23,24], "비정상": [20,25],
    "connection pool": [30,31,32], "not closed": [30,33], "커넥션 풀": [30,34],
    "thread pool": [40,41,42], "스레드": [40,43], "timeout": [50,51,52], "타임아웃": [50,53],
    "jeus": [60,61], "webtob": [62,63], "apache": [64,65], "tomcat": [66,67],
    "critical": [70,71], "error": [72,73], "warning": [74,75], "fatal": [70,76],
    "exception": [72,77], "deadlock": [82,83], "세션": [90,91], "session": [90,92],
    "shutdown": [100,101], "restart": [100,102], "누수": [0,110], "leak": [0,111],
    "포화": [40,120], "exceeded": [40,121], "refused": [20,130], "denied": [20,131],
  };

  for (const [kw, dims] of Object.entries(keywords)) {
    if (lower.includes(kw)) for (const d of dims) vec[d] = 1.0;
  }

  const words = lower.split(/\s+/).filter(w => w.length > 1);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    vec[200 + (Math.abs(hash) % (DIM - 200))] += 0.3;
  }

  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const result: number[] = new Array(DIM);
  for (let i = 0; i < DIM; i++) result[i] = Math.round((vec[i] / norm) * 10000) / 10000;
  return result;
}

async function findSimilarCases(logText: string): Promise<string> {
  try {
    const embedding = generateEmbedding(logText);
    if (!embedding) return "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("match_logs", {
      query_embedding: `[${embedding.join(",")}]`,
      match_threshold: 0.3,
      match_count: 3,
    });

    if (error || !data || data.length === 0) return "";

    const cases = data.map((d: any, i: number) =>
      `[과거 사례 ${i + 1}] (유사도: ${(d.similarity * 100).toFixed(1)}%)\n${d.content}`
    ).join("\n\n");

    return `\n\n--- 유사한 과거 장애 사례 ---\n${cases}\n\n위 과거 사례를 참고하여 분석해줘.`;
  } catch (e) {
    console.error("Similar case lookup failed:", e);
    return "";
  }
}

async function callAnalysis(apiKey: string, userContent: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      tools: analysisTools,
      tool_choice: { type: "function", function: { name: "log_analysis_result" } },
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw { status: 429, message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요." };
    if (response.status === 402) throw { status: 402, message: "크레딧이 부족합니다." };
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw { status: 500, message: "AI gateway error" };
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) return JSON.parse(toolCall.function.arguments);

  const content = data.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);

  throw { status: 500, message: "Could not parse AI response" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { logContent } = await req.json();
    if (!logContent || typeof logContent !== "string") {
      return new Response(JSON.stringify({ error: "logContent is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const truncated = logContent.length > 15000 ? logContent.slice(0, 15000) + "\n...(truncated)" : logContent;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Run similar case lookup AND main analysis in PARALLEL
    const [similarCases, baseResult] = await Promise.all([
      findSimilarCases(truncated.slice(0, 2000), LOVABLE_API_KEY),
      callAnalysis(LOVABLE_API_KEY, `다음 미들웨어 로그를 분석해줘:\n\n${truncated}`),
    ]);

    // If similar cases found, do a quick refinement pass
    if (similarCases) {
      try {
        const refined = await callAnalysis(
          LOVABLE_API_KEY,
          `다음은 초기 분석 결과와 유사 과거 사례야. 과거 사례를 참고해 분석을 보완해줘.\n\n초기 분석:\n${JSON.stringify(baseResult)}\n${similarCases}`
        );
        return new Response(JSON.stringify(refined), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        // Refinement failed, return base result
      }
    }

    return new Response(JSON.stringify(baseResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const status = e.status || 500;
    const message = e.message || "Unknown error";
    console.error("analyze-log error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
