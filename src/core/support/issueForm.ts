// The address of a new issue on GitHub with the short facts filled in (D56, D104). The issue form in
// .github/ISSUE_TEMPLATE/bug.yml takes a field's value from the address by the field's id. Only short
// lines go there - the versions, the system and the Self-test's one-line result - never a path or the
// log: the report itself travels on the clipboard and in a file, and nothing reaches GitHub until the
// user submits.

export const BUG_FORM = "bug.yml";

export type IssueFields = { versions: string; system: string; selfTest?: string | null };

/** No field longer than this goes into the address. */
const MAX_FIELD = 200;

const clip = (text: string) => (text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text);

/** The new-issue address for the bug form, with its title and the fields filled in. */
export function issueFormUrl(newIssueUrl: string, fields: IssueFields): string {
  const params: [string, string][] = [
    ["template", BUG_FORM],
    ["title", "Problem: "],
    ["versions", clip(fields.versions)],
    ["system", clip(fields.system)]
  ];
  if (fields.selfTest) params.push(["self-test", clip(fields.selfTest)]);
  return `${newIssueUrl}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}
