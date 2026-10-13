# Knowledge Curator Proprietary License Requirements

Status: internal decision material only. This document is not the final license and is not legal advice.

## Intended distribution model

- The TypeScript source repository is public for transparency and Community review, but public availability does not itself grant an open-source license.
- The compiled Obsidian plugin (`main.js`, `manifest.json`, and `styles.css` when required) may be distributed publicly for installation and use.
- Copyright and all rights not expressly granted remain with the copyright holder.
- Public availability of compiled JavaScript does not make the product open source and cannot technically prevent inspection or modification of that JavaScript.

## Rights the final license should grant

The final license should grant an end user a limited, non-exclusive, non-transferable, and revocable right to install and use the compiled plugin, subject to the final commercial and usage terms selected by the copyright holder.

The copyright holder must decide before legal drafting:

1. Whether personal backup copies are permitted.
2. Personal and internal organizational use are permitted; external redistribution is not.
3. Whether the license permits use by contractors or affiliated organizations.
4. Whether updates are included and under what conditions.
5. What events permit suspension or termination and what users must do after termination.
6. Whether an account or paid plan may be required in the future.

## Rights the final license should not grant by default

Unless the copyright holder gives separate written permission, the final license should not authorize:

- modification or creation of derivative versions for redistribution;
- redistribution, sublicensing, publishing, sharing, or resale;
- repackaging or re-releasing the plugin under another name;
- offering the plugin as part of another product or hosted service;
- removal of copyright, license, or attribution notices;
- reverse engineering beyond rights that cannot lawfully be restricted in the user's jurisdiction.

The final legal language should distinguish prohibited redistribution from unavoidable local inspection, configuration, interoperability, and any non-waivable statutory rights.

## Compiled artifact and source boundaries

- The existing public repository contains the source and release history. Files excluded by `.gitignore`, including local claim stores, graph stores, human annotations, provider telemetry, private evaluation artifacts, and Vault content, remain private local data.
- Publication of source code and `main.js` supports transparency, Community review, installation, and use; it does not grant modification or redistribution rights beyond the final license.
- The final license should not claim that readable JavaScript is technically protected from analysis or local modification.

## External services and user responsibilities

The final terms should explain that optional external model and search providers have their own terms and privacy practices. Users are responsible for credentials, provider accounts, charges, lawful data submission, and compliance with those providers' terms. Knowledge Curator must not grant rights in third-party services or content.

## Third-party software carve-out

The proprietary license must apply only to Knowledge Curator material owned by the copyright holder. It must not override third-party licenses. Required copyright notices, license texts, attribution, and NOTICE material for bundled dependencies must remain effective and be distributed as required.

Before release, legal review should determine which runtime code is actually included in `main.js` and produce an appropriate third-party notices artifact. Current dependency scanning is an engineering audit, not a legal compatibility opinion.

## Warranty and liability

The final license should include professionally reviewed provisions covering:

- an "as is" warranty disclaimer to the extent permitted by law;
- no guarantee of uninterrupted operation, model output accuracy, search-result accuracy, or knowledge correctness;
- user responsibility for reviewing all proposed knowledge changes;
- limitation of liability and exclusion of indirect or consequential damages where lawful;
- jurisdiction, governing law, dispute resolution, and severability if appropriate.

## Obsidian Community requirements

Obsidian's current Community developer policies require a clearly identified `LICENSE` file, disclosure of network use, and compliance with third-party licenses. The current public-source repository gives reviewers access to source code on GitHub, but its proprietary licensing must be disclosed clearly.

Before replacing the copyright placeholder and publishing the Community release, the copyright holder should:

1. Obtain legal review of the proprietary terms and third-party notices.
2. Finalize the copyright holder's legal name and contact details.
3. Confirm the approved personal-backup and internal organizational-use policy in the final text.
4. Confirm that the public-source/proprietary-license arrangement and disclosures satisfy Community review.

## Explicit non-decisions

This document does not select MIT, Apache-2.0, GPL, BSD, MPL, ISC, or any other standard open-source license. It does not grant public rights, create the final proprietary license, authorize publication, or authorize an Obsidian Community submission.
