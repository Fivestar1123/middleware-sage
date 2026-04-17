import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Deterministic keyword-based embedding generator.
 * Uses predefined middleware/error keyword vocabulary mapped to fixed dimensions.
 * Instant, reliable, no AI call needed.
 */
function generateEmbedding(text: string): number[] {
  const DIM = 1536;
  const vec = new Float64Array(DIM);
  const lower = text.toLowerCase();

  // Middleware & error keyword vocabulary - each keyword maps to specific dimensions
  const keywords: Record<string, number[]> = {
    "outofmemoryerror": [0, 1, 2, 3],
    "oom": [0, 1, 4],
    "heap": [0, 5, 6],
    "gc overhead": [0, 7, 8],
    "full gc": [9, 10, 11],
    "stw": [9, 12],
    "메모리": [0, 1, 13],
    "memory": [0, 1, 14],
    "connection reset": [20, 21, 22],
    "abnormal closed": [20, 23, 24],
    "비정상": [20, 25],
    "connection pool": [30, 31, 32],
    "not closed": [30, 33],
    "커넥션 풀": [30, 34],
    "thread pool": [40, 41, 42],
    "스레드": [40, 43],
    "timeout": [50, 51, 52],
    "타임아웃": [50, 53],
    "jeus": [60, 61],
    "webtob": [62, 63],
    "apache": [64, 65],
    "tomcat": [66, 67],
    "critical": [70, 71],
    "error": [72, 73],
    "warning": [74, 75],
    "fatal": [70, 76],
    "exception": [72, 77],
    "stack overflow": [80, 81],
    "deadlock": [82, 83],
    "세션": [90, 91],
    "session": [90, 92],
    "shutdown": [100, 101],
    "restart": [100, 102],
    "누수": [0, 110],
    "leak": [0, 111],
    "포화": [40, 120],
    "exceeded": [40, 121],
    "refused": [20, 130],
    "denied": [20, 131],
  };

  // Activate keyword dimensions
  for (const [kw, dims] of Object.entries(keywords)) {
    if (lower.includes(kw)) {
      for (const d of dims) {
        vec[d] = 1.0;
      }
    }
  }

  // Hash-based dimensions for general text similarity (dims 200-1535)
  const words = lower.split(/\s+/).filter(w => w.length > 1);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = 200 + (Math.abs(hash) % (DIM - 200));
    vec[idx] += 0.3;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const result: number[] = new Array(DIM);
  for (let i = 0; i < DIM; i++) result[i] = Math.round((vec[i] / norm) * 10000) / 10000;

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth guard
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  {
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: claims, error: claimsErr } = await sbAuth.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { analyses } = await req.json();

    if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
      return new Response(JSON.stringify({ error: "analyses array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const stored: string[] = [];

    // Process all analyses - embedding is instant, no AI call
    for (const analysis of analyses.slice(0, 10)) {
      const textForEmbedding = [
        `[${analysis.severity}] ${analysis.title}`,
        `원인: ${analysis.cause}`,
        `조치: ${analysis.recommendation}`,
        `영향: ${analysis.impact}`,
      ].filter(Boolean).join("\n");

      const embedding = generateEmbedding(textForEmbedding);

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
    }

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
