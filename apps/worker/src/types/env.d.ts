declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    CODE_EXTRACTION_QUEUE: Queue<{ messageId: string }>;
  }
}

export {};
