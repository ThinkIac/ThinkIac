export interface ComposedSchema {
    schema: string;
    outputPath: string;
    sources: string[];
}
export declare function effectiveSchemaPath(packageDir: string): string;
export declare function composePackageSchema(packageDir: string): ComposedSchema | null;
