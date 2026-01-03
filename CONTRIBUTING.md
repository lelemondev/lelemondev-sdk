# Contributing to @lelemondev/sdk

## Branching Strategy

```
main          ← Production releases (auto-publishes to npm)
  │
  └── develop ← Integration branch (PRs target here)
        │
        ├── feat/xxx    ← New features
        ├── fix/xxx     ← Bug fixes
        └── chore/xxx   ← Maintenance
```

### Branch Naming

- `feat/short-description` - New features
- `fix/short-description` - Bug fixes
- `chore/short-description` - Maintenance, docs, refactoring
- `docs/short-description` - Documentation only

### Workflow

1. Create branch from `develop`
2. Make changes
3. Open PR to `develop`
4. After review, merge to `develop`
5. When ready to release, PR from `develop` → `main`
6. Merge to `main` triggers npm publish

## Versioning

We use [Semantic Versioning](https://semver.org/):

- **PATCH** (0.2.1): Bug fixes, no API changes
- **MINOR** (0.3.0): New features, backwards compatible
- **MAJOR** (1.0.0): Breaking changes

Before merging to `main`, update version in `package.json`:

```bash
npm version patch  # or minor, or major
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Type check
npm run typecheck

# Watch mode
npm run dev
```

## Pull Request Checklist

- [ ] Code builds (`npm run build`)
- [ ] Types check (`npm run typecheck`)
- [ ] Version bumped (if targeting main)
- [ ] README updated (if API changed)
