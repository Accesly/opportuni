// Agente de Opportuni: recibe una consulta ("busco prácticas de marketing
// remotas") y responde con vacantes reales de la tabla `vacantes`.
//
// Con ANTHROPIC_API_KEY responde Claude con las vacantes en el contexto (el
// mismo prompt que /api/chat). Sin key, responde por búsqueda de palabras
// sobre las mismas vacantes y lo dice en `modo`.

import Anthropic from "@anthropic-ai/sdk";
import { listVacantesActivas, type VacanteRow } from "./supabase";

export interface RespuestaAgente {
  modo: "ia" | "busqueda";
  mensaje: string;
  vacantes: Array<{ id: string; titulo: string; empresa: string; ubicacion: string; tipo: string; url: string }>;
}

const MAX_VACANTES = 5;

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function aVacante(v: VacanteRow) {
  return {
    id: v.id,
    titulo: v.titulo,
    empresa: v.empresa ?? "",
    ubicacion: v.ubicacion ?? "",
    tipo: v.tipo ?? "remoto",
    url: `/vacantes/${encodeURIComponent(v.id)}`,
  };
}

/** Rankea vacantes por cuántas palabras de la consulta aparecen en ellas. */
export function buscarVacantes(consulta: string, vacantes: VacanteRow[]) {
  const palabras = normalizar(consulta)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 2);
  return vacantes
    .map((v) => {
      const texto = normalizar([v.titulo, v.empresa, v.descripcion, v.ubicacion, v.tipo].join(" "));
      return { v, score: palabras.filter((p) => texto.includes(p)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_VACANTES)
    .map((x) => aVacante(x.v));
}

export async function responderConsulta(consulta: string): Promise<RespuestaAgente> {
  const todas = await listVacantesActivas().catch(() => [] as VacanteRow[]);
  const encontradas = buscarVacantes(consulta, todas);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      modo: "busqueda",
      mensaje: encontradas.length
        ? `Encontré ${encontradas.length} vacante(s) para "${consulta}".`
        : `No hay vacantes activas que coincidan con "${consulta}". Hay ${todas.length} activas en total.`,
      vacantes: encontradas,
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 512,
    system: `Eres el agente de Opportuni, una comunidad que conecta talento en México y Colombia con vacantes. Responde en español, en máximo 4 frases, recomendando solo vacantes de esta lista (usa su id):
${JSON.stringify(todas.map(aVacante))}`,
    messages: [{ role: "user", content: consulta }],
  });
  const mensaje = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const citadas = todas.filter((v) => mensaje.includes(v.id)).map(aVacante);
  return { modo: "ia", mensaje, vacantes: citadas.length ? citadas : encontradas };
}
