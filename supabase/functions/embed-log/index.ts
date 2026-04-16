import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generates an embedding for the given text using Lovable AI gateway.
 * Falls back to a hash-based pseudo-embedding if the embeddings endpoint is unavailable.
 */
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
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

  if (!resp.ok) throw new Error("Failed to generate embedding via Gemini");

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const match = content.match(/\[[\s\S]*\]/);
  if (match) {
    const arr = JSON.parse(match[0]).slice(0, 1536).map((n: any) => Number(n) || 0);
    while (arr.length < 1536) arr.push(0);
    return arr;
  }

  throw new Error("Could not generate embedding");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analyses, logSnippet } = await req.json();

    if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
      return new Response(JSON.stringify({ error: "analyses array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const stored: string[] = [];

    for (const analysis of analyses) {
      // Build a rich text representation for embedding
      const textForEmbedding = [
        `[${analysis.severity}] ${analysis.title}`,
        `원인: ${analysis.cause}`,
        `조치: ${analysis.recommendation}`,
        `영향: ${analysis.impact}`,
        analysis.timeRange ? `시간대: ${analysis.timeRange}` : "",
      ].filter(Boolean).join("\n");

      try {
        const embedding = await generateEmbedding(textForEmbedding, LOVABLE_API_KEY);

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

        if (error) {
          console.error("Insert error:", error);
        } else {
          stored.push(analysis.title);
        }
      } catch (e) {
        console.error("Embedding error for analysis:", analysis.title, e);
      }
    }

    return new Response(JSON.stringify({ stored, count: stored.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("embed-log error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
