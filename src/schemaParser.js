const fs = require('fs');
const path = require('path');
const parser = require('simple-text-parser').default;
const flagDefinitions = ["anonymize", "autonumber"];
let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor

class SchemaParser {
    constructor(filePath) {
        this.filePath = filePath;
    }
    parse() {
        var fileContent = fs.readFileSync(this.filePath, { encoding: 'utf-8' });
        this.type = path.extname(this.filePath).substr(1);
        var lines = fileContent.split(/[\n\r]/g);
        const p = new parser();
        p.addRule(/\"[^\"]+\"/g);
        p.addRule(/[\w\.\_\?]+/g);
        for (var currentLine of lines) {
            var flags = [];
            var line = p.toTree(currentLine.trim()).filter(p => (p.text || "").trim().length > 0).map(p => p.text);
            if (line.length <= 1) continue;
            var type = line[0];
            var isPrimaryKey = false, isForeignKey = false, foreign = null;
            var assigns = [];

            if (line[0] === 'assign') {
                do {
                    assigns.push({
                        action: line[1],
                        execute: new AsyncFunction('db', buildAsyncFunction(eval(line[2])))
                    });
                    line.splice(0, 3);
                } while (line[0] === "assign");
                type = line[0];
            }
            if (flagDefinitions.indexOf(line[0]) > -1) {
                flags.push(line.splice(0, 1)[0]);
            }

            if (type === 'pkey') {
                line.splice(0, 1);
                isPrimaryKey = true;
            }
            if (type === 'fkey') {
                line.splice(0, 1);
                isForeignKey = true;
                foreign = line[0];
                line.splice(0, 1);
            }
            

            if (type === 'def') {
                this.name = line[1];
            }
            else {
                if (this.type === 'table') {
                    if (!this.fields) {
                        this.fields = [];
                    }
                    var isNullable = line[1].endsWith("?");
                    this.fields.push({
                        type: line[0],
                        name: isNullable ? line[1].substr(0, line[1].length - 1) : line[1],
                        defaultValue: line[3],
                        primary: isPrimaryKey,
                        foreign: isForeignKey,
                        reference: foreign,
                        nullable: isNullable,
                        assigns: assigns,
                        flags: flags
                    });
                }
            }
        }
    }
}

function buildAsyncFunction(body) {
    return `return ${body}`;
}

module.exports = SchemaParser;