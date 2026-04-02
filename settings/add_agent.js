const fs = require('fs');
const path = require('path');

const [,, category, name, url, ...descriptionParts] = process.argv;
const description = descriptionParts.join(' ');

if (!category || !name || !url || !description) {
  console.error('Usage: node settings/add_agent.js <category> <name> <url> <description>');
  process.exit(1);
}

const mapping = {
  agents: 'agents-apis-697/README.md',
  ai: 'ai-apis-1208/README.md',
  automation: 'automation-apis-4825/README.md',
  'mcp-servers': 'mcp-servers-apis-131/README.md',
  // add more mappings as needed
};

const readmePath = mapping[category.toLowerCase()];
if (!readmePath) {
  console.error(`Unknown category '${category}'. Update mapping in settings/add_agent.js`);
  process.exit(1);
}

const fullPath = path.join(__dirname, '..', readmePath);
if (!fs.existsSync(fullPath)) {
  console.error(`Category README not found: ${fullPath}`);
  process.exit(1);
}

const data = fs.readFileSync(fullPath, 'utf8');
const lines = data.split('\n');
const tableHeaderIndex = lines.findIndex(line => line.trim().startsWith('| API Name | Description |'));
if (tableHeaderIndex === -1) {
  console.error('Table header not found in target README.');
  process.exit(1);
}

let insertIndex = tableHeaderIndex + 2;
// Find first row after table header to keep sorting; insert before first data row.
for (let i = tableHeaderIndex + 2; i < lines.length; i++) {
  if (lines[i].trim().startsWith('|')) {
    insertIndex = i;
    break;
  }
}

const escapedName = name.replace(/\|/g, '\\|');
const escapedDesc = description.replace(/\|/g, '\\|');
const newRow = `| [${escapedName}](${url}) | ${escapedDesc} |`;

if (lines.some(line => line.includes(`| [${escapedName}](${url}) |`))) {
  console.log('The agent already exists in this category README. No changes made.');
  process.exit(0);
}

lines.splice(insertIndex, 0, newRow);
fs.writeFileSync(fullPath, lines.join('\n'));
console.log(`Added agent entry to ${readmePath}:\n${newRow}`);
