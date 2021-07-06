const path = require('path');
const fs = require('fs');
const schemaParser = require('./schemaParser');
class Migration {
    /**
     * 
     * @param {DatabaseConnection} db 
     */
    constructor(db) {
        this.db = db;
        this.schemas = [];
    }
    registerSchemas(dir) {
        const self = this;
        var files = fs.readdirSync(dir, { withFileTypes: true });
        files.forEach((file) => {
            if (file.isFile()) {
                var parser = new schemaParser(path.join(dir, file.name));
                parser.parse();
                self.schemas.push(parser);
            }
        });
    }
    async migrate() {
        if (!this.db.isKnex) return;
        const db = this.db.db;
        const lastDefinition = path.join(process.cwd(), "fastapi_data_migration.json");
        var lastSchemas = [];
        if (fs.existsSync(lastDefinition)) {
            lastSchemas = JSON.parse(fs.readFileSync(lastDefinition, { encoding: "utf-8" }));
        }

        for (var schema of this.schemas) {
            if (schema.type === 'table') {
                var tableSchema = (lastSchemas || []).filter(p => p.name == schema.name && p.type == schema.type)[0];
                var isExists = await db.existsTable(schema.name);
                if (isExists) {
                    await db.schema.alterTable(schema.name, (builder) => {
                        DefineTableSchema(schema, builder, true, tableSchema);
                    }).catch(console.error);
                }
                else {
                    await db.schema.createTable(schema.name, (builder) => {
                        DefineTableSchema(schema, builder, false, tableSchema);
                    }).catch(console.error);
                }
            }
        }

        fs.writeFileSync(lastDefinition, JSON.stringify(this.schemas), { encoding: 'utf-8' });

    }
}

function DefineTableSchema(schema, builder, isAlter = false, current) {
    if (!current) {
        current = { fields: [] };
    }
    for (var f of schema.fields) {
        var dataType = getKnexDataType(f);
        var _field = builder.specificType(f.name, dataType);
        var currentField = current.fields.filter(p => p.name === f.name)[0];

        if (f.primary && !isAlter) {
            _field.primary();
        }
        if (!f.nullable) {
            _field.notNullable();
        }
        if (isAlter && currentField) {
            _field.alter();
        }
    }
}

function getKnexDataType(f) {
    switch (f.type) {
        case "string":
            return "nvarchar(MAX)";
        case "guid":
        case "uuid":
        case "uniqueidentifier":
            return "uniqueidentifier";
        case "bool":
        case "boolean":
        case "bit":
            return "bit";
        case "int":
        case "integer":
            return "int";
        case "long":
        case "bigint":
            return "bigint";
        case "decimal":
        case "money":
            return "decimal";
        case "binary":
        case "image":
        case "file":
            return "varbinary(MAX)";
        case "json":
        case "text":
        case "xml":
            return "nvarchar(MAX)";
    }
    return "nvarchar(MAX)";
}

module.exports = Migration;