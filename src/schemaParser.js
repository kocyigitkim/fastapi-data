const fs = require('fs');
const path = require('path');
class SchemaParser {
    constructor(filePath) {
        this.filePath = filePath;
    }
    parse() {
        var fileContent = fs.readFileSync(this.filePath, { encoding: 'utf-8' });
        this.type = path.extname(this.filePath).substr(1);
        var lines = fileContent.split(/[\n\r]/g);
        for (var currentLine of lines) {
            var line = currentLine.trim().split(/\s+/g);
            if (line.length <= 1) continue;
            var type = line[0];
            var isPrimaryKey = false, isForeignKey = false, foreign = null;
            var isNullable = line[1].endsWith("?");
            if (isNullable) line[1] = line[1].substr(0, line[1].length - 1);
            if (type === 'pkey') {
                line.splice(0, 1);
                isPrimaryKey = true;
            }
            if (type === 'def') {
                this.name = line[1];
            }
            else {
                if (this.type === 'table') {
                    if (!this.fields) {
                        this.fields = [];
                    }

                    this.fields.push({
                        type: line[0],
                        name: line[1],
                        defaultValue: line[3],
                        primary: isPrimaryKey,
                        foreign: isForeignKey,
                        reference: foreign,
                        nullable: isNullable
                    });
                }
            }
        }
    }
}
module.exports = SchemaParser;