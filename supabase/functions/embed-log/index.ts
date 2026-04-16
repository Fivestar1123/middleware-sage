import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s max per embedding

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
            content: "Output ONLY a valid JSON array of exactly 1536 numbers between -1 and 1. No comments, no extra text. Example: [0.1, -0.2, 0.3, ...]",
          },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || "";

    // Strip JS-style comments that Gemini sometimes adds
    content = content.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]).slice(0, 1536).map((n: any) => Number(n) || 0);
      while (arr.length < 1536) arr.push(0);
      return arr;
    }
  } catch (e) {
    console.error("Embedding generation failed:", e);
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analyses } = await req.json();

    if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
      return new Response(JSON.stringify({ error: "analyses array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Process max 3 analyses, all in PARALLEL
    const topAnalyses = analyses.slice(0, 3);

    const results = await Promise.allSettled(
      topAnalyses.map(async (analysis: any) => {
        const textForEmbedding = [
          `[${analysis.severity}] ${analysis.title}`,
          `원인: ${analysis.cause}`,
          `조치: ${analysis.recommendation}`,
          `영향: ${analysis.impact}`,
        ].filter(Boolean).join("\n");

        const embedding = await generateEmbedding(textForEmbedding, LOVABLE_API_KEY);
        if (!embedding) return null;

        const { error } = await supabase.from("log_knowledge").insert({
          content: textForEmbedding,
          embedding: `[${embedding.join(",")}]`,
          log_level: analysis.severity,
          log_time: new Date().toISOString(),
          metadata: {
            title: analysis.title,
            cause: analysis.cause,
            recommendation: analysis.recommendation,
            impact: analysis.impact,
            relatedLines: analysis.relatedLines,
          },
        });

        if (error) { console.error("Insert error:", error); return null; }
        return analysis.title;
      })
    );

    const stored = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value);

    return new Response(JSON.stringify({ stored, count: stored.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("embed-log error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
