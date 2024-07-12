# debug-attestations

Create summary of missed and late attestations during last 100 epochs

```sh
node missed-and-late-attestations.js validator_indexes_example.txt 
```

Get all attestations of epoch

```sh
node attestations-of-epoch.js validator_indexes_example.txt 209705
```

Get validator indexes for list of pubkeys

```sh
node pubkeys-to-indexes.js ./data/validator_pubkeys.txt ./data/validator_indexes.txt
```
