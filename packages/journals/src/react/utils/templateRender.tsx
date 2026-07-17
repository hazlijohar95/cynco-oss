import type { ReactNode } from 'react';

// On the server, wraps SSR-preloaded shadow-root HTML in a declarative
// shadow DOM template so the browser attaches a styled shadow root before
// any JS runs; on the client the template is skipped and the vanilla class
// adopts the already-parsed shadow root during hydration.
export function templateRender(
  children: ReactNode,
  __html: string | undefined
): ReactNode {
  if (typeof window === 'undefined' && __html != null) {
    return (
      <>
        <template
          // @ts-expect-error unclear how to fix this
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html }}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}
