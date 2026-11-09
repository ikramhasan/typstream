// request: Explain how a leaf makes food, for grade 8, with a sequence diagram and a pie chart of what a plant needs.
= How a leaf makes food

```mermaid
sequenceDiagram
  participant Roots
  participant Leaf
  participant Air
  Roots->>Leaf: Water
  Air->>Leaf: Carbon dioxide
  Note over Leaf: Sunlight drives photosynthesis
  Leaf->>Air: Oxygen
  Leaf-->>Roots: Glucose (sugar)
```

The plant's dry mass comes almost entirely from the air:

```mermaid
pie title Where a plant's dry mass comes from
  "Carbon dioxide (air)" : 95
  "Minerals (soil)" : 5
```
