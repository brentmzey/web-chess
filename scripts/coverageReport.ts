import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../src/utils/logger';

interface FileCoverageMetrics {
  file: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
  branchesFound: number;
  branchesHit: number;
}

/**
 * Parses `coverage/lcov.info` and AST control-flow branches to produce a
 * JaCoCo / SonarQube-style Line, Function, and Branch coverage report.
 */
function generateCoverageSummary(): void {
  const lcovPath = resolve(process.cwd(), 'coverage/lcov.info');
  const rawLcov = readFileSync(lcovPath, 'utf-8');

  const records = rawLcov.split('end_of_record').filter(r => r.trim().length > 0);
  const metrics: FileCoverageMetrics[] = [];

  for (const rec of records) {
    const lines = rec.trim().split('\n');
    let file = '';
    let lf = 0;
    let lh = 0;
    let fnf = 0;
    let fnh = 0;
    let brf = 0;
    let brh = 0;
    const hitLineNumbers = new Set<number>();

    for (const line of lines) {
      if (line.startsWith('SF:')) file = line.slice(3).trim().replace(/\\/g, '/');
      else if (line.startsWith('LF:')) lf = parseInt(line.slice(3), 10) || 0;
      else if (line.startsWith('LH:')) lh = parseInt(line.slice(3), 10) || 0;
      else if (line.startsWith('FNF:')) fnf = parseInt(line.slice(4), 10) || 0;
      else if (line.startsWith('FNH:')) fnh = parseInt(line.slice(4), 10) || 0;
      else if (line.startsWith('BRF:')) brf = parseInt(line.slice(4), 10) || 0;
      else if (line.startsWith('BRH:')) brh = parseInt(line.slice(4), 10) || 0;
      else if (line.startsWith('DA:')) {
        const [lineNoStr, countStr] = line.slice(3).split(',');
        const lineNo = parseInt(lineNoStr || '0', 10);
        const count = parseInt(countStr || '0', 10);
        if (count > 0) hitLineNumbers.add(lineNo);
      }
    }

    // If LCOV omits BRF/BRH records, compute branch decision points from source lines & DA hits
    if (brf === 0 && file) {
      try {
        const absFile = resolve(process.cwd(), file);
        const srcLines = readFileSync(absFile, 'utf-8').split('\n');
        srcLines.forEach((srcLine, idx) => {
          const lineNum = idx + 1;
          const trimmed = srcLine.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            return;
          }
          const branchMatches =
            trimmed.match(/\b(if|else\s+if|switch|case)\b|\?\s*[^:?]+\s*:|(\|\||&&|\?\?)/g) || [];
          if (branchMatches.length > 0) {
            const countBranches = branchMatches.length * 2;
            brf += countBranches;
            if (hitLineNumbers.has(lineNum)) {
              brh += countBranches;
            }
          }
        });
      } catch {
        // Ignore if virtual or external file
      }
    }

    if (file) {
      metrics.push({
        file,
        linesFound: lf,
        linesHit: lh,
        functionsFound: fnf,
        functionsHit: fnh,
        branchesFound: brf,
        branchesHit: brh
      });
    }
  }

  let totalLF = 0;
  let totalLH = 0;
  let totalFNF = 0;
  let totalFNH = 0;
  let totalBRF = 0;
  let totalBRH = 0;

  const pct = (hit: number, found: number): string =>
    found === 0 ? '100.00%' : `${((hit / found) * 100).toFixed(2)}%`;

  let md = `# 📊 JaCoCo / SonarQube Code Coverage Report\n\n`;
  md += `| Source File | Line Coverage | Branch Coverage | Function Coverage | Lines (Hit/Total) | Branches (Hit/Total) |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const m of metrics) {
    totalLF += m.linesFound;
    totalLH += m.linesHit;
    totalFNF += m.functionsFound;
    totalFNH += m.functionsHit;
    totalBRF += m.branchesFound;
    totalBRH += m.branchesHit;

    md += `| \`${m.file}\` | **${pct(m.linesHit, m.linesFound)}** | **${pct(m.branchesHit, m.branchesFound)}** | **${pct(m.functionsHit, m.functionsFound)}** | ${m.linesHit}/${m.linesFound} | ${m.branchesHit}/${m.branchesFound} |\n`;
  }

  const totalLinePct = pct(totalLH, totalLF);
  const totalBranchPct = pct(totalBRH, totalBRF);
  const totalFuncPct = pct(totalFNH, totalFNF);

  md += `| **TOTAL (All Modules)** | **${totalLinePct}** | **${totalBranchPct}** | **${totalFuncPct}** | **${totalLH}/${totalLF}** | **${totalBRH}/${totalBRF}** |\n`;

  const reportOutPath = resolve(process.cwd(), 'coverage/coverage-report.md');
  writeFileSync(reportOutPath, md, 'utf-8');

  logger.info('SonarQube / JaCoCo Coverage Summary Generated', {
    lineCoverage: totalLinePct,
    branchCoverage: totalBranchPct,
    functionCoverage: totalFuncPct,
    lines: `${totalLH}/${totalLF}`,
    branches: `${totalBRH}/${totalBRF}`,
    functions: `${totalFNH}/${totalFNF}`,
    lcovFile: 'coverage/lcov.info',
    markdownReport: 'coverage/coverage-report.md'
  });
}

generateCoverageSummary();
