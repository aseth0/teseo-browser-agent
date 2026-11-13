// Stands in for the MCP SDK's Ajv validator (wxt.config.ts aliases it here): Ajv compiles code with
// new Function, which an extension's CSP forbids, and it is the biggest part of the SDK. The client
// is given its own validator (mcp/connect), so this one is never used.
export class AjvJsonSchemaValidator {
  getValidator() {
    return (input: unknown) => ({ valid: true as const, data: input, errorMessage: undefined });
  }
}
