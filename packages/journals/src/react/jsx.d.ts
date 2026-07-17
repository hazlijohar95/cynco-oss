import 'react';
import type { JOURNALS_TAG_NAME } from '../constants';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [JOURNALS_TAG_NAME]: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
