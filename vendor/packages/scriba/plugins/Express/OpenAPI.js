function openApiType(type) {
  switch (type) {
    case "Int":
    case "Float":
      return "number";
    case "Boolean":
      return "boolean";
    case "String":
    case "DateTime":
    case "Json":
    default:
      return "string";
  }
}

const paramId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" }
};

function jsonBody(modelSchemaRef) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: modelSchemaRef
      }
    }
  };
}

export default function OpenAPI(scriba, tenantId) {
  const tenant = scriba.tenant(tenantId);
  const tables = tenant._scriba._tenants[tenantId].tables;

  const openapi = {
    openapi: "3.0.0",
    info: {
      title: `Scriba API - Tenant ${tenantId}`,
      version: "1.0.0"
    },
    paths: {},
    components: {
      schemas: {}
    },
    tags: [],
    servers: [
      {
        url: `https://api.scriba.cloud/${tenantId}`,
        description: "Scribe Rest"
      }
    ]
  };

  for (const [name, table] of Object.entries(tables)) {
    const modelName = table._modelName;

    // Adiciona a tag da entidade
    openapi.tags.push({ name: modelName, description: `Rest API - ${modelName} Endpoints` });

    // Schema completo (incluindo id e relações)
    const fullSchema = {
      type: "object",
      properties: {},
      required: []
    };

    // Schema para criação (omitindo id e relações)
    const createSchema = {
      type: "object",
      properties: {},
      required: []
    };

    // Schema para atualização (omitindo id e relações)
    const updateSchema = {
      type: "object",
      properties: {},
      required: []
    };

    for (const f of table._fields) {
      const fieldSchema = { type: openApiType(f.type) };

      // Full schema inclui todos os campos
      fullSchema.properties[f.name] = fieldSchema;
      if (f.required) fullSchema.required.push(f.name);

      // Create schema: ignora id e campos relacionais
      if (f.name !== "id" && !(f.name in table._relations)) {
        createSchema.properties[f.name] = fieldSchema;
        if (f.required) createSchema.required.push(f.name);
      }

      // Update schema: ignora id e campos relacionais
      if (f.name !== "id" && !(f.name in table._relations)) {
        updateSchema.properties[f.name] = fieldSchema;
        if (f.required) updateSchema.required.push(f.name);
      }
    }

    openapi.components.schemas[modelName] = fullSchema;
    openapi.components.schemas[`${modelName}Create`] = createSchema;
    openapi.components.schemas[`${modelName}Update`] = updateSchema;

    const base = `/v1/${modelName}`;

    // CRUD
    openapi.paths[base] = {
      get: {
        tags: [modelName],
        summary: `List all ${modelName}`,
        responses: { 200: { description: "OK" } }
      },
      post: {
        tags: [modelName],
        summary: `Create ${modelName}`,
        requestBody: jsonBody({ $ref: `#/components/schemas/${modelName}Create` }),
        responses: { 200: { description: "Created" } }
      }
    };

    openapi.paths[`${base}/{id}`] = {
      get: {
        tags: [modelName],
        summary: `Get ${modelName} by ID`,
        parameters: [paramId],
        responses: { 200: { description: "OK" } }
      },
      patch: {
        tags: [modelName],
        summary: `Update ${modelName}`,
        parameters: [paramId],
        requestBody: jsonBody({ $ref: `#/components/schemas/${modelName}Update` }),
        responses: { 200: { description: "Updated" } }
      },
      delete: {
        tags: [modelName],
        summary: `Delete ${modelName}`,
        parameters: [paramId],
        responses: { 200: { description: "Deleted" } }
      }
    };

    // Relações (somente GET/POST de relacionamento, mas sem incluir nos payloads principais)
    for (const relName in table._relations) {
      const rel = table._relations[relName];
      const childModel = tables[rel.table]._modelName;
      const path = `/v1/${modelName}/{id}/${relName}`;

      openapi.paths[path] = {
        get: {
          tags: [modelName],
          summary: `List ${childModel} related to ${modelName}`,
          parameters: [paramId],
          responses: { 200: { description: "OK" } }
        },
        post: {
          tags: [modelName],
          summary: `Create ${childModel} related to ${modelName}`,
          parameters: [paramId],
          requestBody: jsonBody({ $ref: `#/components/schemas/${childModel}Create` }),
          responses: { 200: { description: "Created" } }
        }
      };
    }
  }

  return openapi;
}
