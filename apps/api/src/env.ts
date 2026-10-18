export type ApiEnv = {
  APP_DB?: CloudflareBindings["APP_DB"];
  CORS_ORIGINS?: string;
};

export type AppEnv = { Bindings: ApiEnv };
