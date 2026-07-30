import type { PipelineManifest } from './contracts';

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  value?: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validatePipelineManifest(value: unknown): ValidationResult<PipelineManifest> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['manifest must be an object'] };
  }

  for (const field of ['id', 'name', 'description', 'version']) {
    if (!nonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (value.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0');

  if (!isRecord(value.inputSchema) || value.inputSchema.type !== 'object' || !isRecord(value.inputSchema.properties)) {
    errors.push('inputSchema must be an object schema with properties');
  }

  if (!Array.isArray(value.requiredCapabilities) || !value.requiredCapabilities.every(nonEmptyString)) {
    errors.push('requiredCapabilities must be a string array');
  }
  if (!Array.isArray(value.supportedRuntimes) || !value.supportedRuntimes.every(nonEmptyString)) {
    errors.push('supportedRuntimes must be a string array');
  }

  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    errors.push('stages must be a non-empty array');
  } else {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const [index, stage] of value.stages.entries()) {
      if (!isRecord(stage)) {
        errors.push(`stages[${index}] must be an object`);
        continue;
      }
      if (!nonEmptyString(stage.id)) errors.push(`stages[${index}].id must be non-empty`);
      if (!nonEmptyString(stage.name)) errors.push(`stages[${index}].name must be non-empty`);
      if (!nonEmptyString(stage.description)) errors.push(`stages[${index}].description must be non-empty`);
      if (!nonEmptyString(stage.role)) errors.push(`stages[${index}].role must be non-empty`);
      if (!Number.isInteger(stage.order) || Number(stage.order) < 1) errors.push(`stages[${index}].order must be a positive integer`);
      if (!Array.isArray(stage.requiredCapabilities) || !stage.requiredCapabilities.every(nonEmptyString)) {
        errors.push(`stages[${index}].requiredCapabilities must be a string array`);
      }
      if (nonEmptyString(stage.id)) {
        if (ids.has(stage.id)) errors.push(`duplicate stage id: ${stage.id}`);
        ids.add(stage.id);
      }
      if (Number.isInteger(stage.order)) {
        const order = Number(stage.order);
        if (orders.has(order)) errors.push(`duplicate stage order: ${order}`);
        orders.add(order);
      }
    }
  }

  return errors.length === 0
    ? { valid: true, errors, value: value as unknown as PipelineManifest }
    : { valid: false, errors };
}
