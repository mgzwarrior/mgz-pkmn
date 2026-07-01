/**
 * Example card-list queries shown in [InputEditor](./InputEditor.tsx)'s
 * guided empty state — split into its own module (not exported from
 * InputEditor) so react-refresh doesn't flag a component file for
 * exporting a non-component value.
 */
export const EXAMPLE_QUERIES = [
  'Charizard | Base Set | 4/102',
  'Pikachu | Jungle',
  'Squirtle | 7/102',
  'Mew ex',
  'Charizard [holo]',
  'top:5 Charizard cards',
  'All Charizard cards | Base Set',
  'Pikachu >=20 <=50',
]
