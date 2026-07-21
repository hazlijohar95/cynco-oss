import 'react';
import type { STATEMENTS_TAG_NAME } from '../constants';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [STATEMENTS_TAG_NAME]: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
