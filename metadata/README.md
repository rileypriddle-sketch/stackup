# StackUp Metadata

Upload these JSON files to Pinata (or any IPFS pinning service) and then set the resulting `ipfs://...` URI in the `streak-v3` contract via `set-badge-uri`.

Recommended flow:
1. Upload the image(s) (PNG).
1. Update the JSON `image` field to `ipfs://<IMAGE_CID>`.
1. Upload the JSON.
1. Call `set-badge-uri(kind, uri)` where:
1. `kind` is the milestone number (e.g. `7`)
1. `uri` is `ipfs://<METADATA_CID>`
