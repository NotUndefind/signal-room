# Refonte de la découverte des topics MQTT — Design

**Date :** 2026-05-31
**Statut :** Validé (brainstorming)
**Plan d'implémentation :** à générer via `writing-plans`

---

## Contexte

Aujourd'hui le dashboard (`apps/frontend/src/app/page.tsx`) affiche, en plus des devices configurés, une carte `DiscoveredCard` par topic non-configuré observé sur le broker. Avec un broker poussant des centaines de topics, le dashboard devient illisible.

La page `/devices` propose la sélection des topics via un `<datalist>` plat, sans aucune vue de la hiérarchie réelle des topics MQTT.

## Objectif

1. Sortir du dashboard la liste des topics non-configurés.
2. La déplacer dans `/devices` sous forme d'arborescence basée sur les segments MQTT (`/`).
3. Cliquer une feuille pré-remplit le formulaire d'ajout et focus le champ Nom.
4. Préserver la saisie manuelle avec wildcards MQTT (`+`, `#`).

## Critères de réussite

- Le dashboard n'affiche plus aucune card pour topic non-configuré.
- `/devices` affiche l'arborescence complète des topics observés, navigable.
- Cliquer une feuille **non-configurée** pré-remplit le champ Topic et focus le champ Nom.
- L'utilisateur peut toujours saisir un topic à la main avec wildcards.
- Tests Vitest pour `buildTopicsTree`, `filterTree`, et `TopicsTree`.
- Aucun changement backend.

## Décisions produit

| Sujet | Décision |
| --- | --- |
| Scope de l'arbre | Tous les topics observés, ceux déjà configurés sont marqués visuellement |
| Clic sur dossier | Toggle expand/collapse uniquement |
| Clic sur feuille non-configurée | Pré-remplit le champ Topic + focus le champ Nom |
| Clic sur feuille configurée | Aucune action |
| Layout `/devices` | 3 colonnes : Configurés \| Découverts (arbre) \| Ajouter ; stack vertical en mobile |
| Expansion par défaut | Tout collapsé ; champ de recherche auto-expand les branches matchantes |
| Métadonnées feuille | Badge état (`[configuré]` ou `●`) + tooltip natif `title=""` (last_seen · count · type) |
| Refresh | Bouton manuel qui appelle `fetchTopicsSeen()` + `fetchRegistry()` |

## Architecture des fichiers

### Frontend — nouveaux

- `apps/frontend/src/lib/topics-tree.ts` — types `TreeNode` + fonctions pures `buildTopicsTree`, `filterTree`
- `apps/frontend/src/lib/topics-tree.test.ts`
- `apps/frontend/src/lib/mqtt-matcher.ts` — copie du matcher backend (~10 lignes)
- `apps/frontend/src/lib/mqtt-matcher.test.ts` — copie de la suite backend
- `apps/frontend/src/components/devices/TopicsTree.tsx` — racine : recherche + render des nodes
- `apps/frontend/src/components/devices/TopicNode.tsx` — node récursif (dossier ou feuille)
- `apps/frontend/src/components/devices/TopicsTree.test.tsx`

### Frontend — modifiés

- `apps/frontend/src/app/page.tsx` — retirer le rendu des `DiscoveredCard` non-configurées, supprimer `useRouter`, `fetchTopicsSeen`, `discoveredTopics`, `unregisteredTopics`, imports `DiscoveredCard`.
- `apps/frontend/src/app/devices/page.tsx` — passer en grille 3 colonnes, supprimer le `<datalist>`, intégrer `TopicsTree`, ajouter le bouton refresh, ajouter `nameInputRef` pour le focus après prefill.

### Frontend — supprimés

- `apps/frontend/src/components/devices/DiscoveredCard.tsx` — plus aucun consommateur.

### Backend

Aucun changement. Les routes `/api/topics` et `/api/registry` existantes suffisent. La transformation flat → arbre est faite côté client.

## Modèle de données

### Type `TreeNode`

```ts
export interface TreeNode {
  segment: string         // dernier segment ('chambre', 'state', …)
  path: string            // chemin complet MQTT ('frigate/chambre/enabled/state')
  children: TreeNode[]    // [] si feuille
  isLeaf: boolean         // children.length === 0
  topic?: TopicSeen       // présent uniquement si isLeaf
  configured: boolean     // feuille : matche un pattern enregistré ; dossier : true si AU MOINS UN descendant l'est
  allConfigured: boolean  // feuille : === configured ; dossier : true si TOUS les descendants le sont
}
```

Pas de référence vers le parent : sérialisable, pas de cycle, plus simple à tester.

`configured` et `allConfigured` sont distincts pour permettre les trois états visuels du badge dossier : aucun configuré (`!configured`), tous configurés (`allConfigured`), mixte (`configured && !allConfigured`).

### `buildTopicsTree`

```ts
export function buildTopicsTree(
  topics: TopicSeen[],
  registeredPatterns: string[],
): TreeNode[]
```

Algorithme :

1. Pour chaque `topic`, splitter sur `/`, descendre via une `Map<string, TreeNode>` à chaque niveau ; créer les nodes manquants.
2. Sur le dernier segment : `isLeaf = true`, attacher `topic`.
3. Pour chaque feuille, calculer `configured` via `mqttTopicMatches(pattern, path)` sur les patterns enregistrés ; `allConfigured = configured`.
4. Propager aux ancêtres en remontée : `configured = children.some(c => c.configured)` ; `allConfigured = children.every(c => c.allConfigured)`.
5. Trier chaque niveau alphabétiquement par `segment`, dossiers avant feuilles.

### `filterTree`

```ts
export function filterTree(
  tree: TreeNode[],
  query: string,
): { filtered: TreeNode[]; expandedPaths: Set<string> }
```

- `query === ''` → retourne `{ filtered: tree, expandedPaths: new Set() }`.
- Sinon : conserve toute branche dont une feuille a `path.toLowerCase().includes(query.toLowerCase())`. `expandedPaths` contient les paths de tous les ancêtres des feuilles matchantes.

### Matcher MQTT côté frontend

`mqttTopicMatches` est dupliqué depuis `apps/backend/src/mqtt/matcher.ts` vers `apps/frontend/src/lib/mqtt-matcher.ts` (et sa suite de tests). Justification : le monorepo n'a pas de package partagé ; en créer un pour 10 lignes serait disproportionné. Les deux copies sont gardées synchronisées via les deux suites de tests identiques.

## Composants UI

### `TopicsTree.tsx`

**Props** :

```ts
interface TopicsTreeProps {
  topics: TopicSeen[]
  registeredPatterns: string[]
  onSelectTopic: (topic: string) => void
}
```

**État local** :

- `search: string` — debounce 150 ms via `useDeferredValue`.
- `manuallyExpanded: Set<string>` — paths que l'utilisateur a togglés.

**Render** :

- Header : `<input>` recherche avec icône `Search` (lucide-react).
- Calcul mémoïsé `tree` = `buildTopicsTree(topics, registeredPatterns)`.
- Calcul mémoïsé `{ filtered, expandedPaths }` = `filterTree(tree, deferredSearch)`.
- Set effectif d'expansion : `new Set([...manuallyExpanded, ...expandedPaths])`.
- Body : `filtered.map(node => <TopicNode … />)`.
- États vides :
  - `topics.length === 0` → « Aucun topic découvert pour le moment. Vérifiez la connexion MQTT. »
  - `filtered.length === 0` (recherche sans match) → « Aucun topic ne correspond à `<query>`. »

### `TopicNode.tsx`

**Props** :

```ts
interface TopicNodeProps {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelectTopic: (topic: string) => void
}
```

**Dossier** (`!node.isLeaf`) :

- Bouton plein largeur, `padding-left: depth * 16px`.
- Chevron `ChevronRight` / `ChevronDown` selon `expandedPaths.has(node.path)`.
- Texte `{segment}/` en `font-mono`.
- Badge `[configuré]` si `node.allConfigured` ; point `●` sinon (au moins une feuille descendante est nouvelle).
- `onClick={() => onToggle(node.path)}`.
- Si expanded : render des `children` récursivement.

**Feuille** (`node.isLeaf`) :

- `padding-left: depth * 16px`.
- Texte `{segment}` en `font-mono`.
- Badge à droite : `[configuré]` (shadcn `Badge variant="secondary"`, opacité 70 %) ou point `●` (couleur primary, « nouveau »).
- Si `!node.configured` : élément `<button>` avec focus visible → `onSelectTopic(node.path)`.
- Si `node.configured` : élément non-interactif (span), pas d'event handler.
- `title="Dernière vue : 14:23:05 · 142 messages · type : raw"` natif sur la feuille.

### Intégration dans `/devices/page.tsx`

Grille : `grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-6`.

Trois sections :

1. **Devices configurés** (gauche) — inchangée.
2. **Topics découverts** (centre) — header avec bouton refresh + `<TopicsTree />`.
3. **Ajouter un device** (droite) — formulaire actuel, `<datalist>` supprimée.

**Bouton refresh** :

- `Button variant="ghost" size="icon"` avec icône `RotateCw` (lucide), `aria-label="Rafraîchir"`.
- `onClick` → `Promise.all([fetchTopicsSeen(), fetchRegistry()])`, met à jour les deux states.
- Pendant le fetch : `animate-spin` sur l'icône, `disabled`.

**Pré-remplissage** :

- `nameInputRef = useRef<HTMLInputElement>(null)` ajouté au champ Nom.
- `handleSelectTopic(topic)` → `setTopicPattern(topic)` puis `nameInputRef.current?.focus()` dans le même tick.
- `useSearchParams().get('topic')` conservé pour la rétrocompatibilité de l'URL `?topic=…`.

### Composants shadcn

Aucun ajout. `card`, `badge`, `button`, `select` déjà installés.

## Data flow

### Mount

```
useEffect [] →
  Promise.all([ fetchRegistry(), fetchTopicsSeen() ])
  setRegistry(devices); setTopicsSeen(topics)
```

Erreur sur un fetch : log console, l'autre source s'affiche quand même.

### Dérivation

```ts
const registeredPatterns = useMemo(
  () => registry.flatMap(d => d.topic_patterns),
  [registry],
)
// `tree` et `filtered` sont dérivés à l'intérieur de TopicsTree via useMemo.
```

### Ajout / suppression

- Ajout : `setRegistry(prev => [...prev, new])` → `registeredPatterns` change → la feuille passe de `●` à `[configuré]` sans refetch.
- Suppression : symétrique.

### Recherche

- Match : `path.toLowerCase().includes(query.toLowerCase())` — substring case-insensitive.
- Pas de surlignage du match (YAGNI).
- Effacer la query conserve `manuallyExpanded`, perd les auto-expands.

### Topics avec wildcards enregistrés

Le matcher gère `+` et `#`. Une feuille `frigate/principale/events` est marquée configurée si un device a le pattern `frigate/+/events`. Aucun cas particulier dans `buildTopicsTree`.

### Pas de régression dashboard

- WS inchangé.
- Rendu des devices configurés inchangé.
- Imports `DiscoveredCard`, `useRouter`, `fetchTopicsSeen`, `discoveredTopics`, `unregisteredTopics` supprimés (typecheck garantit qu'aucun consommateur ne reste).

## Tests

### `topics-tree.test.ts`

**`buildTopicsTree`** :

- `[]` → `[]`.
- Topic mono-segment (`'wled'`) → un node feuille racine.
- Topic profond (`'frigate/chambre/enabled/state'`) → arborescence 4 niveaux, `topic` attaché uniquement sur la feuille.
- Préfixe partagé : `'frigate/a/x'`, `'frigate/a/y'`, `'frigate/b/z'` → un seul `frigate` avec deux enfants `a` et `b`, deux feuilles sous `a`.
- Tri : enfants triés alphabétiquement, dossiers avant feuilles à niveau égal.
- `configured` :
  - feuille avec pattern exact → `true`.
  - feuille avec pattern wildcard (`'frigate/principale/events'` matché par `'frigate/+/events'`) → `true`.
  - dossier dont au moins une feuille est configurée → `true`.
  - dossier dont aucune feuille n'est configurée → `false`.
- `allConfigured` :
  - dossier dont toutes les feuilles descendantes sont configurées → `true`.
  - dossier dont au moins une feuille est nouvelle → `false`.
- Insertion défensive : deux fois le même topic → pas de doublon.

**`filterTree`** :

- Query vide → arbre identique, `expandedPaths` vide.
- Query matchant une feuille → branches non-matchantes coupées, `expandedPaths` contient tous les ancêtres.
- Query case-insensitive (`'CHAM'` matche `'chambre'`).
- Query sans match → `[]` + `expandedPaths` vide.

### `mqtt-matcher.test.ts` (frontend)

Copie verbatim des 7 tests de `apps/backend/src/mqtt/matcher.test.ts`.

### `TopicsTree.test.tsx`

Avec `@testing-library/react` :

- Render initial : tous les dossiers racine présents et collapsés (chevron `▶`).
- Toggle dossier : clic → enfants visibles, chevron `▼` ; second clic → repliés.
- Recherche auto-expand : tape `'state'` → branche correspondante visible, autres masquées.
- Recherche reset : effacer → tout re-collapse.
- Clic feuille non-configurée : `onSelectTopic` appelée avec le bon path.
- Clic feuille configurée : `onSelectTopic` non appelée ; visuel distinct.
- Badge état : feuille configurée → `[configuré]` ; feuille nouvelle → `●`.
- Tooltip natif : feuille a `title` contenant la sous-chaîne `'message'`.
- État vide : `topics={[]}` → message « Aucun topic découvert ».

### Tests volontairement exclus (YAGNI)

- Bouton refresh dans `/devices/page.tsx` : intégration triviale.
- Suppression de `DiscoveredCard` : retrait, validé par typecheck + run manuel.
- Focus du champ Nom après prefill : `ref.current?.focus()` trivial, vérifié manuellement.

## Commande de vérification

```bash
cd apps/frontend && npx vitest run
cd apps/frontend && npx tsc --noEmit
```

Attendu : la suite existante (6 tests) + nouveaux tests passent, aucune régression typecheck.
