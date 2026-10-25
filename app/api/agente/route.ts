import { NextResponse } from "next/server";
import { createAcceslyResourceServer, priceEndpoint, withX402Payment } from "@accesly/core/payments";
import { responderConsulta } from "../../lib/agente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agente de Opportuni con cobro por uso (x402): cada consulta cuesta
// X402_PRICE (default $0.01 USDC) y se paga desde una wallet Accesly, que
// firma con su session key; el facilitador liquida on-chain antes de que la
// respuesta salga. Si el agente responde con error, no se cobra.
//
//   GET  /api/agente?q=busco+practicas+de+marketing
//   POST /api/agente  { "consulta": "..." }
//
// Variables: X402_PAY_TO (cuenta que cobra), X402_FACILITATOR_URL,
// X402_NETWORK (stellar:testnet), X402_PRICE.
const NETWORK = process.env.X402_NETWORK ?? "stellar:testnet";

const route = priceEndpoint({
  price: process.env.X402_PRICE ?? "$0.01",
  payTo: process.env.X402_PAY_TO ?? "",
  network: NETWORK,
  description: "Opportuni job-matching agent, one query",
});

let server: ReturnType<typeof createAcceslyResourceServer> | undefined;
const getServer = () =>
  (server ??= createAcceslyResourceServer({
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "",
    networks: [NETWORK],
  }));

async function atender(consulta: string) {
  if (!consulta.trim()) {
    return NextResponse.json({ error: "Falta la consulta." }, { status: 400 });
  }
  return NextResponse.json(await responderConsulta(consulta.slice(0, 500)));
}

function cobrado(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!process.env.X402_PAY_TO || !process.env.X402_FACILITATOR_URL) {
      return NextResponse.json({ error: "El cobro x402 no está configurado." }, { status: 503 });
    }
    return withX402Payment(handler, route, getServer())(req);
  };
}

export const GET = cobrado(async (req) => atender(new URL(req.url).searchParams.get("q") ?? ""));

export const POST = cobrado(async (req) => {
  const body = await req.json().catch(() => ({}));
  return atender(typeof body.consulta === "string" ? body.consulta : "");
});
