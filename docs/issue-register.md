# Issue and Root-Cause Register

Every material finding receives an `SB-<phase>-<sequence>` identifier.

| ID | Phase | Severity | Summary | Root cause | Status |
|---|---:|---|---|---|---|
| SB-001-001 | 1 | High (gate only) | Runtime initially staged in the production repository because repository creation was unavailable to the connected tool. | GitHub connector exposed branch/file/commit operations but not repository creation. | Corrected: account owner created this separate repository; final CI/audit pending. |

Critical and High findings block progression until closed and regression-tested.
