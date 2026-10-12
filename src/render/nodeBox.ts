/**
 * Width of the border NodeLayer draws round every node. It is inside the
 * node's box (border-box), and a node's stored size includes it, so the box
 * the document holds is exactly the box on screen — which is what connectors,
 * Fit and export all work from.
 *
 * In a module of its own because both the registry and the views it imports
 * need it, and a value shared through the registry would be an import cycle.
 */
export const NODE_BORDER = 2
