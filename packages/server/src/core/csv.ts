/** Splits RFC 4180 text into records with the 1-based line each record starts on. */
function records(text: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      out.push({ line: start, fields });
      fields = []; field = ''; line++; start = line;
    } else field += c;
  }
  if (field !== '' || fields.length) { fields.push(field); out.push({ line: start, fields }); }
  return out.filter((r) => r.fields.some((f) => f.trim() !== ''));
}

/** Longest team name accepted: what fits on one projector line in two columns at 26 tables. */
export const TEAM_NAME_MAX = 35;
export const teamNameTooLong = (name: string) => [...name].length > TEAM_NAME_MAX;

export function parseTeamsCsv(text: string): { rows: { team: string; category: string }[]; errors: string[] } {
  const all = records(text);
  const errors: string[] = [];
  const header = all[0]?.fields.map((f) => f.trim().toLowerCase());
  if (!header || header[0] !== 'team' || header[1] !== 'category') {
    return { rows: [], errors: ['The first row must be the header: team,category'] };
  }
  const rows: { team: string; category: string }[] = [];
  const seen = new Map<string, number>();
  for (const { line, fields } of all.slice(1)) {
    const team = (fields[0] ?? '').trim();
    const category = (fields[1] ?? '').trim();
    if (!team || !category) {
      errors.push(`line ${line}: team and category are both required`);
      continue;
    }
    if (teamNameTooLong(team)) {
      errors.push(`line ${line}: "${team}" is ${[...team].length} characters; team names can be at most ${TEAM_NAME_MAX}`);
      continue;
    }
    const key = team.toLowerCase();
    if (seen.has(key)) {
      errors.push(`line ${line}: duplicate team "${team}" (first on line ${seen.get(key)})`);
      continue;
    }
    seen.set(key, line);
    rows.push({ team, category });
  }
  return { rows, errors };
}
