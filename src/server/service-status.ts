export interface ServiceHealth {
  status: "active" | "partial" | "down";
  services: {
    database: { status: string; latency: number };
    vectorStore: { status: string; latency: number };
    openai: { status: string; latency: number };
  };
}

export async function calculateServiceStatus(env: any): Promise<ServiceHealth> {
  const health: ServiceHealth = {
    status: "active",
    services: {
      database: { status: "unknown", latency: 0 },
      vectorStore: { status: "unknown", latency: 0 },
      openai: { status: "unknown", latency: 0 },
    },
  };

  if (env.DB) {
    try {
      const dbStart = Date.now();
      await env.DB.prepare("SELECT 1").first();
      health.services.database = {
        status: "healthy",
        latency: Date.now() - dbStart,
      };
    } catch (error) {
      health.services.database = { status: "unhealthy", latency: 0 };
      health.status = "partial";
    }
  } else {
    health.services.database = { status: "not configured", latency: 0 };
  }

  if (env.VECTORIZE && env.OPENAI_API_KEY) {
    health.services.vectorStore = { status: "configured", latency: 0 };
  } else {
    health.services.vectorStore = { status: "not configured", latency: 0 };
  }

  if (env.OPENAI_API_KEY) {
    health.services.openai = { status: "configured", latency: 0 };
  } else {
    health.services.openai = { status: "not configured", latency: 0 };
    health.status = "partial";
  }

  const criticalServices = [health.services.database, health.services.openai];
  if (criticalServices.some((service) => service.status === "unhealthy")) {
    health.status = "down";
  }

  return health;
}
