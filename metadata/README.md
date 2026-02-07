# StackUp Metadata

Upload these JSON files to Pinata (or any IPFS pinning service) and then set the resulting `ipfs://...` URI on-chain.

Recommended flow:
1. Upload the image(s) (PNG).
1. Update the JSON `image` field to `ipfs://<IMAGE_CID>`.
1. Upload the JSON.
1. Call `set-badge-uri(kind, uri)` where:
1. `kind` is the milestone number (e.g. `7`)
1. `uri` is `ipfs://<METADATA_CID>`

For paid/creator NFTs, upload a metadata JSON the same way and set it using the appropriate admin function in the deployed contract (the frontend/admin panel will wire this up).
