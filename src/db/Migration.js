const path = require('path');
const fs = require('fs');
const schemaParser = require('./SchemaParser');
const schemaLoader = require('knex-schema-loader');
const { default: knex } = require('knex');
class Migration {
    /**
     * 
     * @param {DatabaseConnection} db 
     */
    constructor(db) {
        this.db = db;
        /** @type {schemaParser[]} */
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
    getSchema(name) {
        return this.schemas.filter(p => p.name === name)[0];
    }
    async exportSchemas(dir) {
        if (!this.db.isKnex) return;
        const db = this.db.db;

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        var tables = await schemaLoader.getTables(db);
        for (var table of tables.filter(p => p.type.indexOf('TABLE') > -1)) {
            var tableColumns = ((await schemaLoader.getColumns(db, table.name)) || []).sort((a, b) => a.position - b.position);
            var strTable = `def ${table.name}\n`;
            for (var col of tableColumns) {
                if (col.isprimary) {
                    strTable += `pkey ${getRealDataType(col.type, col.length)} ${col.name}`;
                }
                else if (col.isforeign) {
                    strTable += `fkey ${col.foreignTable} ${getRealDataType(col.type, col.length)} ${col.name}`;
                }
                else {
                    strTable += `${getRealDataType(col.type, col.length)} ${col.name}`;
                }
                if (col.nullable) {
                    strTable += '?\n';
                }
                else {
                    strTable += '\n';
                }
            }
            var fsPath = path.join(dir, table.name + ".table");
            fs.writeFileSync(fsPath, strTable, { encoding: 'utf-8' });
        }
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
/**
 * 
 * @param {*} schema 
 * @param {} builder 
 * @param {*} isAlter 
 * @param {*} current 
 */
function DefineTableSchema(schema, builder, isAlter = false, current) {
    if (!current) {
        current = { fields: [] };
    }
    var deletedFields = current.fields.filter(p => schema.fields.filter(sf => sf.name === p.name).length === 0);
    for (var f of deletedFields) {
        builder.dropColumn(f.name);
        if (f.foreign) {
            builder.dropForeign(f.name);
        }
        if (f.primary) {
            builder.dropPrimary("PK_" + schema.name + "_" + f.name);
        }
    }

    for (var f of schema.fields.filter(p => deletedFields.filter(df => df.name === p.name).length === 0)) {
        var currentField = current.fields.filter(p => p.name === f.name)[0];

        var dataType = getKnexDataType(f);
        var _field = builder.specificType(f.name, dataType);
        if (f.foreign) {
            if (!currentField || (currentField && currentField.foreign !== f.foreign)) {
                builder.foreign(f.name).references(f.reference);
            }
        }
        if (f.primary && !isAlter) {
            if (!currentField || (currentField && currentField.primary !== f.primary)) {
                builder.primary(f.name, "PK_" + schema.name + "_" + f.name);
            }
        }
        if (!f.nullable) {
            _field.notNullable();
        } else {
            _field.nullable();
        }
        if (isAlter && currentField) {
            _field.alter();
        }
    }
}
function getRealDataType(type, length) {
    switch (type) {
        case "nvarchar":
            return "string";
        case "uniqueidentifier":
            return "guid";
        case "bit":
            return "boolean";
        case "int":
            return "int";
        case "bigint":
            return "long";
        case "decimal":
            return "decimal";
        case "varbinary":
            return "binary";
    }
    return "string";
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