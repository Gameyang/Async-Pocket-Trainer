# Pokemon battle data

`pokemonBattleData.json` is generated from the CSV files in
`veekun/pokedex` at commit `cc483e1877f22b8c19ac27ec0ff5fafd09c5cd5b`.
`pokemonBattleRuntimeData.json` is a smaller runtime subset with only the default complete
learnset group.

Coverage:

- Pokedex numbers `1` through `151`
- Current base stats, typing, abilities, capture/growth fields, and in-range evolutions
- Type efficacy for the 18 regular battle types
- All moves learnable by those 151 Pokemon across the source version groups
- Move power, PP, accuracy, priority, damage class, target, flags, stat changes, and short effects

Learnset entries use `[moveId, level, order]`. Non-level-up methods usually have `level` set to
`0`. The latest source version group that covers all 151 Pokemon is
`lets-go-pikachu-lets-go-eevee`, exposed as `coverage.defaultLearnsetVersionGroup`.

Source: <https://github.com/veekun/pokedex/tree/master/pokedex/data/csv>

The source project is MIT licensed, but its README notes that Pokemon game data remains the
intellectual property of Nintendo, Creatures, inc., and GAME FREAK, inc.
