# Design System — MaCitadine.com

## 1. Visual Theme & Atmosphere

Interface chaleureuse et dynamique — comme une concession moderne tenue par une femme qui sait exactement ce qu'elle veut. Aérée sans être froide, premium sans être austère. Les formes sont douces (coins très arrondis), la hiérarchie passe par la couleur et le poids typographique, jamais par l'excès décoratif. Le fond crème évite le blanc clinique. Le coral apporte de l'énergie sans agressivité. Le teal ancre la confiance.

- **Density:** 4/10 — Balancé, respirant, jamais surchargé
- **Variance:** 6/10 — Layouts asymétriques, cartes de tailles variées
- **Motion:** 6/10 — Transitions fluides CSS, micro-interactions subtiles

---

## 2. Palette de Couleurs

| Nom | Hex | Rôle |
|-----|-----|------|
| **Coral Vif** | `#fd6a63` | Accent primaire — CTA, highlights, prix, badges actifs |
| **Teal Profond** | `#005163` | Secondaire — header, cartes dark, textes importants |
| **Rose Doux** | `#fad1d1` | Accent light — hover states, backgrounds de sections |
| **Crème Chaud** | `#fff5f6` | Background principal — jamais blanc pur |
| **Beige Neutre** | `#d8d2ce` | Borders, séparateurs, états désactivés |
| **Charcoal Ink** | `#2e3a3d` | Texte principal — jamais noir pur |
| **Surface Blanche** | `#ffffff` | Cartes, modales, inputs |
| **Muted Stone** | `#8a9a9d` | Texte secondaire, labels, placeholders |

**Règles :**
- Maximum 1 couleur d'accent par écran (Coral)
- Jamais de noir pur `#000000`
- Jamais de dégradés neon ou purple
- Le Coral en fond = uniquement sur des zones courtes (badges, boutons)

---

## 3. Typographie

### Titres — League Spartan
```
Font-family: 'League Spartan', sans-serif
Import: https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;600;700;800;900
```
- H1 : 800, lettre-espacement -1px, couleur Teal Profond ou Coral
- H2 : 700, couleur Charcoal Ink
- H3 : 600, couleur Charcoal Ink
- Labels uppercase : 600, letter-spacing 1.5px, taille 11-12px

### Corps — Inter
```
Font-family: 'Inter', sans-serif
Import: https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600
```
- Body : 400/500, 15-16px, couleur Charcoal Ink
- Secondaire : 400, 13-14px, couleur Muted Stone
- Max 65 caractères par ligne pour le confort de lecture

### Interdit
- Titres en Inter — toujours League Spartan pour les headings
- Serif (Times, Georgia, Garamond)
- Font-size sous 12px

---

## 4. Composants

### Boutons
- **Primaire :** Background Coral `#fd6a63`, texte blanc, border-radius 100px (pill), padding 14px 28px, font-weight 700, League Spartan
- **Secondaire :** Background transparent, border 2px Teal, texte Teal, même border-radius
- **Ghost :** Background Rose Doux `#fad1d1`, texte Coral, sans border
- **Active state :** translateY(-1px), légère ombre colorée `rgba(253,106,99,0.3)`
- **Interdit :** Glow neon, ombres violettes, border-radius < 8px sur les boutons

### Cartes
- Background blanc `#ffffff`
- Border : 1px solid `rgba(216,210,206,0.6)`
- Border-radius : 20px
- Box-shadow : `0 4px 24px rgba(0,81,99,0.08)` — ombre teintée teal, pas grise
- Hover : translateY(-2px), ombre légèrement plus forte
- **Interdit :** Ombre grise générique, border-radius < 12px

### Inputs
- Background blanc, border 1.5px `#d8d2ce`
- Focus : border-color Coral `#fd6a63`, ring `rgba(253,106,99,0.15)`
- Border-radius : 12px
- Label au-dessus, erreur en dessous
- **Interdit :** Floating labels, borders bleutés génériques

### Badges / Tags
- Border-radius : 100px
- Taille : 11-12px, font-weight 700, uppercase
- Coral : `rgba(253,106,99,0.12)` bg + `#fd6a63` texte
- Teal : `rgba(0,81,99,0.10)` bg + `#005163` texte

### Progress / Étapes
- Couleur active : Coral `#fd6a63`
- Couleur done : Teal `#005163`
- Connecteurs : gradient Coral → Teal quand complétés

---

## 5. Layout

- **Max-width :** 960px centré, padding horizontal 20px
- **Grid :** CSS Grid prioritaire sur Flexbox math
- **Sections :** `gap: clamp(2rem, 5vw, 4rem)` entre les sections
- **Cards grid :** 2 colonnes asymétriques préférées au 3-colonnes égales
- **Pas de layouts centrés génériques** — utiliser split ou left-aligned
- **Mobile (< 768px) :** Tout en colonne unique, pas d'overflow horizontal

---

## 6. Motion & Interactions

- **Transitions :** 200-300ms ease, jamais linear
- **Hover cards :** `transform: translateY(-2px)` + ombre renforcée
- **Boutons actifs :** `transform: translateY(-1px)` sur hover, `translateY(0)` sur clic
- **Apparition éléments :** `opacity 0 → 1` + `translateY(8px → 0)` en 300ms
- **Progress bar :** Transition width 600ms cubic-bezier(0.34, 1.56, 0.64, 1)
- **Compteurs :** Animation ease-out cubique sur les nombres
- **Interdit :** Animations sur width/height/top/left — uniquement transform et opacity

---

## 7. Anti-Patterns Interdits

- Fond sombre / dark mode — MaCitadine est toujours claire et chaleureuse
- Accents violet, bleu neon, purple — univers tech générique
- Emojis dans l'interface (sauf si contenu utilisateur)
- `#000000` noir pur
- 3 cartes égales en ligne horizontale
- Texte "Scroll to explore", flèches clignotantes
- Police Inter pour les titres
- Dégradés de texte sur les grands titres
- Boutons avec glow extérieur
- Fond blanc pur `#ffffff` comme background principal — toujours `#fff5f6`
- Clichés copywriting : "Révolutionnaire", "Next-Gen", "Seamless", "Unleash"

---

## 8. Ton & Voix

- **Direct et chaleureux** — comme une amie experte en voiture
- **Pas condescendant** — l'utilisatrice sait ce qu'elle veut
- **Prix clairs** — pas de jargon technique non expliqué
- **CTA actifs** — "Calculer ma cote", "Voir les prix", jamais "Soumettre"
