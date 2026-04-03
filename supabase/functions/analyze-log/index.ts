import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

반드시 JSON만 반환해. 다른 텍스트 없이.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { logContent } = await req.json();
    
    if (!logContent || typeof logContent !== "string") {
      return new Response(JSON.stringify({ error: "logContent is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate very large logs to avoid token limits
    const truncated = logContent.length > 15000 ? logContent.slice(0, 15000) + "\n...(truncated)" : logContent;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `다음 미들웨어 로그를 분석해줘:\n\n${truncated}` },
        ],
        tools: [
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
        ],
        tool_choice: { type: "function", function: { name: "log_analysis_result" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "크레딧이 부족합니다. Settings > Workspace > Usage에서 충전해주세요." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback: try to parse content as JSON
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return new Response(jsonMatch[0], {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Could not parse AI response");
  } catch (e) {
    console.error("analyze-log error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
