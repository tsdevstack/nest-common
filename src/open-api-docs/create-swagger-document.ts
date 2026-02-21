import { INestApplication } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from "@nestjs/swagger";

export interface SwaggerConfig {
  title: string;
  description: string;
  version?: string; // defaults to "1.0.0"
  tags?: string[];
  globalPrefix?: string; // Service global prefix - auto-populated by createApp
}

export function createSwaggerDocument(
  app: INestApplication,
  config: SwaggerConfig
): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle(config.title)
    .setDescription(config.description)
    .setVersion(config.version || "1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      "bearer"
    )
    .addApiKey(
      {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
      "api-key"
    );

  // Add tags if provided
  if (config.tags) {
    config.tags.forEach((tag) => {
      builder.addTag(tag);
    });
  }

  return SwaggerModule.createDocument(app, builder.build());
}
