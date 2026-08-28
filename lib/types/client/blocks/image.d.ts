import { type ReactNode } from 'react';
import type { GenuiImage } from '../spec.ts';
/** Native image display; source safety is enforced by repairGenuiSpec/safeMediaSrc. */
export declare function ImageNode({ node }: {
    node: GenuiImage;
}): ReactNode;
