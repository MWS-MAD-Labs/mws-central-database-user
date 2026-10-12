// Prints a key for APP_SECRETS_KEY. Put the line in Central's .env.
import { randomBytes } from "crypto";

console.log(`APP_SECRETS_KEY="${randomBytes(32).toString("base64")}"`);
