// Shared language parser. Loading it does not load SQLite or the Scriba runtime.
import parser from "logos/dist/src/schema/scriba-parser.js";
export const { loadPrismaModels, parseScribaSchema } = parser;
