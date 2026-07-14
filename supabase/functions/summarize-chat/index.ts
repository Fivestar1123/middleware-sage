import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: claims, error: claimsErr } = await sb.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (claimsErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { qaPairs } = await req.json();
    if (!Array.isArray(qaPairs) || qaPairs.length === 0) {
      return new Response(JSON.stringify({ summaries: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `너는 LogMind야. 사용자와 AI의 Q&A를 보고서용으로 간결하게 요약해.
각 Q&A를 다음 JSON 스키마로 변환해서 배열로만 반환해 (다른 텍스트 절대 금지):
[{"question":"질문 한 줄 요약","cause":"원인 요약","action":"조치 방법 요약(번호 목록 가능)","impact":"예상 영향 범위 요약"}]
- 마크다운/이모지 사용 금지, 순수 텍스트만
- 각 필드는 핵심만 압축 (cause/impact 2~3문장, action은 단계별)
- 정보가 없으면 "해당 없음"`;

    const userPrompt = `다음 Q&A들을 요약해줘:\n\n${qaPairs
      .map((p: any, i: number) => `### Q&A ${i + 1}\n[질문]\n${p.question}\n\n[답변]\n${p.answer}`)
      .join("\n\n---\n\n")}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      throw new Error(`AI gateway error: ${response.status} ${t}`);
    }
    const data = await response.json();
    let content: string = data.choices?.[0]?.message?.content ?? "[]";
    // strip code fences if any
    content = content.replace(/```json\s*|\s*```/g, "").trim();
    let summaries: any[] = [];
    try {
      summaries = JSON.parse(content);
    } catch {
      const m = content.match(/\[[\s\S]*\]/);
      if (m) summaries = JSON.parse(m[0]);
    }

    return new Response(JSON.stringify({ summaries }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
