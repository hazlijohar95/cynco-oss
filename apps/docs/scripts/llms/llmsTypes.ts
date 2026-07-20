/** Static site facts shared by both generated llms documents. */
export interface LlmsSite {
  title: string;
  /** One-line suite summary rendered as the spec's blockquote. */
  summary: string;
  /** Deployed docs origin, no trailing slash. */
  baseUrl: string;
  githubUrl: string;
  installCommand: string;
  /** Extra one-line facts listed after the summary in the index. */
  notes: readonly string[];
}

/** One published package as listed in the llms.txt index. */
export interface LlmsPackageSummary {
  name: string;
  version: string;
  description: string;
}

/** One published package's section in llms-full.txt. */
export interface LlmsPackageSection extends LlmsPackageSummary {
  /** Absolute docs-page URL, or null when the package has no dedicated page. */
  docsUrl: string | null;
  /** Transformed markdown body (README plus any companion docs). */
  body: string;
}

/** A docs-site page linked from the llms.txt index. */
export interface LlmsDocsPage {
  label: string;
  url: string;
  description: string;
}
