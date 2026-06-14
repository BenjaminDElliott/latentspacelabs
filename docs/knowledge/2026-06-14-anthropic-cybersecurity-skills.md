---
title: "Anthropic Cybersecurity Skills — 754 Structured Agent Skills Framework"
date: "2026-06-14"
source: "GitHub: mukul975/Anthropic-Cybersecurity-Skills"
relevance: 5
related: []
---

# Anthropic Cybersecurity Skills — 754 Structured Agent Skills Framework

## Overview

**Anthropic-Cybersecurity-Skills** (GitHub: [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)) is the largest open-source cybersecurity skills library for AI agents, containing **754 structured cybersecurity skills** organized across **26 security domains**. Created by Mahipal Jangra, the project is licensed under **Apache 2.0** and currently has **15,639 stars** on GitHub. It follows the **[agentskills.io](https://agentskills.io)** open standard and is compatible with **26+ AI platforms** including Claude Code, GitHub Copilot, Codex CLI, Cursor, Gemini CLI, and any MCP-compatible agent.

The project addresses the global cybersecurity workforce gap of **4.8 million unfilled roles** (ISC2, 2024) by providing AI agents with the structured decision-making workflows that senior security analysts use — covering *when* to use each technique, *what* prerequisites to check, *how* to execute step-by-step, and *how* to verify results.

### Key Statistics

| Metric | Value |
|---|---|
| Total Skills | 754 |
| Security Domains | 26 |
| Framework Mappings | 5 (cross-mapped) |
| Compatible Platforms | 26+ |
| License | Apache 2.0 |
| Repository Stars | 15,639 |
| Author | Mahipal Jangra (@mukul975) |

### Progressive Disclosure Architecture

A core innovation is **progressive skill loading**: each skill costs ~30 tokens to scan (frontmatter only) and 500–2,000 tokens to fully load (complete workflow). This lets agents search all 754 skills in a single pass without exhausting context windows. The agent workflow is:

1. **Scan** 754 skill frontmatters (~30 tokens each) → identify ~12 relevant skills by matching tags, description, domain
2. **Load** top 3 matches with full workflow
3. **Execute** step-by-step with real tool commands
4. **Validate** results using verification section, map findings to framework IDs

## Five Security Frameworks — One Skill Library

The project is notable for being the **only open-source skills library** that maps every skill across all five frameworks simultaneously. This is the key differentiator: one skill, five compliance checkboxes.

### 1. MITRE ATT&CK v19.1 — 754/754 skills mapped

Every skill carries `mitre_attack` frontmatter validated against **MITRE ATT&CK v19.1** using the official `mitreattack-python` library. Coverage: **286 distinct techniques** across all **15 Enterprise tactics**, plus ICS and Mobile techniques. Zero revoked or deprecated IDs.

| Tactic | ID | Skills Mapped |
|--------|----|---------------|
| Reconnaissance | TA0043 | 103 |
| Resource Development | TA0042 | 22 |
| Initial Access | TA0001 | 467 |
| Execution | TA0002 | 350 |
| Persistence | TA0003 | 444 |
| Privilege Escalation | TA0004 | 464 |
| Stealth | TA0005 | 442 |
| Defense Impairment | TA0112 | 92 |
| Credential Access | TA0006 | 202 |
| Discovery | TA0007 | 237 |
| Lateral Movement | TA0008 | 68 |
| Collection | TA0009 | 172 |
| Command and Control | TA0011 | 123 |
| Exfiltration | TA0010 | 82 |
| Impact | TA0040 | 50 |

> ATT&CK v19 splits Defense Evasion (TA0005) into *Stealth* and *Defense Impairment* (April 2026). An ATT&CK Navigator layer file is included in releases.

### 2. NIST CSF 2.0 — All 6 functions covered

NIST CSF 2.0 (February 2024) added the **Govern** function, expanding scope from critical infrastructure to all organizations. Skill mappings align to all **22 categories** and reference **106 subcategories**.

| Function | Skills | Examples |
|---|---|---|
| Govern (GV) | 30+ | Risk strategy, policy frameworks, roles & responsibilities |
| Identify (ID) | 120+ | Asset discovery, threat landscape assessment, risk analysis |
| Protect (PR) | 150+ | IAM hardening, WAF rules, zero trust, encryption |
| Detect (DE) | 200+ | Threat hunting, SIEM correlation, anomaly detection |
| Respond (RS) | 160+ | Incident response, forensics, breach containment |
| Recover (RC) | 40+ | Ransomware recovery, BCP, disaster recovery |

### 3. MITRE ATLAS v5.4 — AI/ML Adversarial Threats

ATLAS covers **16 tactics and 84 techniques** specific to AI and machine learning systems. Late 2025 update added **agentic AI attack vectors**: AI agent context poisoning, tool invocation abuse, MCP server compromises, and malicious agent deployment. Skills help agents identify and defend against threats to ML pipelines, model weights, inference APIs, and autonomous workflows.

### 4. MITRE D3FEND v1.3 — Defensive Countermeasures

NSA-funded knowledge graph of **267 defensive techniques** organized across 7 tactical categories: **Model, Harden, Detect, Isolate, Deceive, Evict, and Restore**. Built on OWL 2 ontology with a shared Digital Artifact layer for bidirectional mapping of defensive countermeasures to ATT&CK offensive techniques. Tagged skills let agents recommend specific countermeasures for detected threats.

### 5. NIST AI RMF 1.0 + GenAI Profile (AI 600-1)

Defines **4 core functions** (Govern, Map, Measure, Manage) with **72 subcategories** for trustworthy AI development. The GenAI Profile adds **12 risk categories** specific to generative AI (confabulation, data privacy, prompt injection, supply chain risks). Colorado's AI Act (effective February 2026) provides a **legal safe harbor** for NIST AI RMF compliance.

### Cross-Framework Example

| Skill | ATT&CK | NIST CSF | ATLAS | D3FEND | AI RMF |
|---|---|---|---|---|---|
| `analyzing-network-traffic-of-malware` | T1071 | DE.CM | AML.T0047 | D3-NTA | MEASURE-2.6 |

## 26 Security Domains

Skills are organized into 26 security domains, each with a distinct skill count and capability set:

| # | Domain | Skills | Key Capabilities |
|---|---|---|---|
| 1 | **Cloud Security** | 60 | AWS, Azure, GCP hardening, CSPM, cloud forensics |
| 2 | **Threat Hunting** | 55 | Hypothesis-driven hunts, LOTL detection, behavioral analytics |
| 3 | **Threat Intelligence** | 50 | STIX/TAXII, MISP, feed integration, actor profiling |
| 4 | **Web Application Security** | 42 | OWASP Top 10, SQLi, XSS, SSRF, deserialization |
| 5 | **Network Security** | 40 | IDS/IPS, firewall rules, VLAN segmentation, traffic analysis |
| 6 | **Malware Analysis** | 39 | Static/dynamic analysis, reverse engineering, sandboxing |
| 7 | **Digital Forensics** | 37 | Disk imaging, memory forensics, timeline reconstruction |
| 8 | **Security Operations** | 36 | SIEM correlation, log analysis, alert triage |
| 9 | **Identity & Access Management** | 35 | IAM policies, PAM, zero trust identity, Okta, SailPoint |
| 10 | **SOC Operations** | 33 | Playbooks, escalation workflows, metrics, tabletop exercises |
| 11 | **Container Security** | 30 | K8s RBAC, image scanning, Falco, container forensics |
| 12 | **OT/ICS Security** | 28 | Modbus, DNP3, IEC 62443, historian defense, SCADA |
| 13 | **API Security** | 28 | GraphQL, REST, OWASP API Top 10, WAF bypass |
| 14 | **Vulnerability Management** | 25 | Nessus, scanning workflows, patch prioritization, CVSS |
| 15 | **Incident Response** | 25 | Breach containment, ransomware response, IR playbooks |
| 16 | **Red Teaming** | 24 | Full-scope engagements, AD attacks, phishing simulation |
| 17 | **Penetration Testing** | 23 | Network, web, cloud, mobile, wireless pentesting |
| 18 | **Endpoint Security** | 17 | EDR, LOTL detection, fileless malware, persistence hunting |
| 19 | **DevSecOps** | 17 | CI/CD security, code signing, Terraform auditing |
| 20 | **Phishing Defense** | 16 | Email authentication, BEC detection, phishing IR |
| 21 | **Cryptography** | 14 | TLS, Ed25519, certificate transparency, key management |
| 22 | **Zero Trust Architecture** | 13 | BeyondCorp, CISA maturity model, microsegmentation |
| 23 | **Mobile Security** | 12 | Android/iOS analysis, mobile pentesting, MDM forensics |
| 24 | **Ransomware Defense** | 7 | Precursor detection, response, recovery, encryption analysis |
| 25 | **Compliance & Governance** | 5 | CIS benchmarks, SOC 2, regulatory frameworks |
| 26 | **Deception Technology** | 2 | Honeytokens, breach detection canaries |

**Domain distribution insight**: The top 3 domains (Cloud Security, Threat Hunting, Threat Intelligence) contain 165 skills (22% of total). The bottom 2 domains (Compliance & Governance, Deception Technology) are the most underdeveloped and need community contributions most.

## agentskills.io Standard vs. Hermes Skill Format

### agentskills.io Standard (used by Anthropic-Cybersecurity-Skills)

The agentskills.io standard defines a **YAML frontmatter + Markdown body** structure:

```yaml
---
name: analyzing-network-traffic-of-malware
description: >-
  Analyzes network traffic generated by malware during sandbox execution...
  Includes agent-discovery keywords for automatic activation.
domain: cybersecurity
subdomain: malware-analysis
tags: [malware, network-analysis, PCAP, Wireshark, C2-detection]
version: "1.0.0"
author: mahipal
license: Apache-2.0
nist_csf: [DE.AE-02, RS.AN-03, ID.RA-01, DE.CM-01]
mitre_attack: [T1071.001, T1571, T1573, T1095]
---
```

**SKILL.md structure (body):**
- `## When to Use` — activation triggers with positive and negative conditions
- `## Prerequisites` — required tools, versions, permissions
- `## Workflow` — numbered steps with real CLI commands in code blocks
- `## Key Concepts` — reference tables
- `## Tools & Systems` — technology inventory
- `## Common Scenarios` — use-case variations
- `## Output Format` — expected result structure

**Directory structure per skill:**
```
skills/skill-name/
├── SKILL.md              ← YAML frontmatter + Markdown body
├── references/
│   ├── standards.md      ← Framework mappings, CVE refs, MITRE links
│   └── workflows.md      ← Deep technical procedure
├── scripts/
│   └── process.py        ← Working helper scripts
└── assets/
    └── template.md       ← Checklists, templates
```

### Hermes Skill Format (current)

Hermes skills use a similar YAML frontmatter + Markdown body approach but with domain-specific differences:

```yaml
---
name: dispatch-harness
category: devops
description: Deterministic ticket dispatch engine for Linear flywheel...
version: 1.0.0
---
```

**Hermes SKILL.md structure (body):**
- `## Overview` — what the skill does
- `## How It Works` — implementation details, often with diagrams or examples
- `## Pitfalls` — common errors, gotchas, anti-patterns (Hermes-specific, very valuable)
- `## Cron Integration` — scheduling patterns
- `## Scripts` — file references
- `## State Transitions` — workflow diagrams

### Comparison Table

| Feature | agentskills.io | Hermes Format | Notes |
|---|---|---|---|
| **YAML Frontmatter** | Required, rich metadata | Required, minimal metadata | agentskills.io has structured framework refs |
| **Framework Mapping** | `mitre_attack`, `nist_csf`, `mitre_atlas`, `d3fend`, `ai_rmf` | None natively | agentskills.io has a major advantage for security domains |
| **Domain/Subdomain** | Explicit `domain` + `subdomain` fields | `category` (single level) | agentskills.io's 2-level taxonomy is more granular |
| **Tags** | Tool/framework/technique tags | Optional tags | agentskills.io tags are designed for agent discovery |
| **When to Use** | Dedicated section with activation triggers | Implied in description/overview | agentskills.io has better agent-trigger design |
| **Prerequisites** | Dedicated section with tool versions | Mixed into overview | agentskills.io is more structured |
| **Workflow** | Numbered steps with real commands | Varied, often state-machine style | Both effective; different patterns |
| **Pitfalls** | Rarely used | **Core section** (Hermes strength) | Hermes has this unique advantage |
| **Supporting Files** | `references/`, `scripts/`, `assets/` | Inline or external file refs | agentskills.io has richer companion structure |
| **Token Awareness** | Explicit: ~30 tokens scan, 500-2000 load | Implicit via length | agentskills.io documents token cost |
| **Cross-Platform** | Designed for 26+ agents | Hermes-optimized | agentskills.io is portable; Hermes is platform-specific |

### Key Differences in Philosophy

- **agentskills.io** is designed as a **universal exchange format** — skills must work across platforms with minimal modification. This means more standardized structure, explicit activation triggers, and framework-tagged metadata for machine parsing.
- **Hermes format** is designed for **operational depth** — the Pitfalls section alone captures tacit knowledge from real agent runs that agentskills.io-style skills rarely document. Hermes skills tend to be more implementation-specific and less portable.

## Integration Potential for Hermes Flywheel

### High-Value Integration Opportunities

**1. Security Domain Gap Analysis**
Hermes currently lacks dedicated cybersecurity skills. The 26-domain taxonomy from Anthropic-Cybersecurity-Skills provides a ready-made framework for identifying which security capabilities Hermes agents need. The most immediately useful domains for the Hermes flywheel would be:
- **Cloud Security** (60 skills) — relevant to our multi-repo, multi-platform deployments
- **SOC Operations** (33 skills) — monitoring, alert triage, playbook execution
- **Incident Response** (25 skills) — breach containment, Ransomware response
- **Endpoint Security** (17 skills) — EDR, LOTL detection
- **Vulnerability Management** (25 skills) — scanning workflows, patch prioritization

**2. agentskills.io Format Adoption**
Hermes could adopt agentskills.io frontmatter conventions for new security skills:
- Add `domain`/`subdomain` fields to Hermes skill frontmatter (alongside `category`)
- Add structured `mitre_attack` and `nist_csf` fields for security-skilled agents
- Add `tags` designed for agent discovery (tool names, techniques)
- Keep the Hermes `Pitfalls` section — it's a unique strength

**3. Skill Format Converter**
A bidirectional converter between agentskills.io and Hermes formats would:
- Allow importing existing 754 skills into Hermes
- Allow exporting Hermes operational knowledge into agentskills.io standard
- Enable cross-platform skill sharing (Hermes → Claude Code, Cursor, etc.)

**4. Multi-Framework Mapping Pattern**
The approach of mapping skills to multiple frameworks simultaneously could inform how Hermes structures its operational skills. Currently Hermes skills map to Linear projects and workflows; adding framework mappings (e.g., mapping deployment skills to NIST CSF functions) would create cross-referencing power.

**5. Progressive Disclosure for Context Management**
The agentskills.io approach of ~30-token frontmatter scans is valuable for Hermes agents with limited context windows. Adopting this pattern — structured discovery data separate from full execution workflows — could reduce token usage for Hermes skill loading.

### Recommended Integration Path

| Phase | Action | Effort | Impact |
|---|---|---|---|
| **Phase 1** | Import top 20 high-value skills into Hermes as operational knowledge | Low | High — immediate capability gain |
| **Phase 2** | Add agentskills.io-style frontmatter fields to new Hermes skills | Low | Medium — better discovery, cross-platform portability |
| **Phase 3** | Build converter utility between agentskills.io and Hermes formats | Medium | High — bidirectional skill migration |
| **Phase 4** | Map existing Hermes skills to security frameworks | Medium | Medium — cross-referencing, compliance visibility |
| **Phase 5** | Contribute Hermes-specific patterns back to agentskills.io | Low | Medium — community reciprocity |

### Risks and Considerations

- **Scope creep**: 754 skills is comprehensive but overwhelming. Hermes should curate — import only skills relevant to its operational domain, not all 754.
- **Platform mismatch**: agentskills.io skills assume agent platforms with Claude Code / Codex CLI command execution. Hermes agents may need adaptation for their specific tooling.
- **Maintenance burden**: Framework mappings (MITRE ATT&CK v19, NIST CSF 2.0) change over time. Imported skills need periodic validation.
- **Token cost**: Full skill loading at 500-2000 tokens per skill requires careful management in Hermes' context windows.

## Sources

1. [GitHub: Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
2. [agentskills.io](https://agentskills.io) — the skill standard
3. [MITRE ATT&CK v19.1](https://attack.mitre.org)
4. [NIST CSF 2.0](https://www.nist.gov/cyberframework)
5. [MITRE ATLAS v5.4](https://atlas.mitre.org)
6. [MITRE D3FEND v1.3](https://d3fend.mitre.org)
7. [NIST AI RMF 1.0](https://airc.nist.gov/AI_RMF)
8. [ISC2 Cybersecurity Workforce Study 2024](https://www.isc2.org/Insights/2024/08/2024-Cybersecurity-Workforce-Study)
