import { pt } from "zod/locales";

// Per-parse localization avoids changing global Zod behavior in other requests.
export const validationOptions = { error: pt().localeError };
