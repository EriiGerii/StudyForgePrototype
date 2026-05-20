# Demo Plan – StudyForge

| Elementi | Përmbajtja |
|----------|-------------|
| **Emri i projektit** | StudyForge |
| **Prezantuesi** | Ermir Gerguri (@EriiGerii) |
| **Kohëzgjatja** | 6–7 minuta |
| **Live URL** | https://study-forge-prototype.vercel.app |
| **GitHub Repo** | https://github.com/EriiGerii/study-forge |

## 1. Çka është projekti dhe kujt i shërben?
StudyForge është një "Smart Study Lab" që shndërron materialet e studimit në përvojë interaktive. Shërben për studentë, profesorë dhe persona me vështirësi fokusimi.

**Veçoritë unike:** Profile & autentifikim, histori e ruajtur, 7 lojëra adaptive, progres.

## 2. Flow-i kryesor i demos
1. Hapja dhe regjistrimi (30 sek)
2. Ngarkimi i PDF/tekstit (30 sek)
3. Gjenerimi – 6 hapa loading (45 sek)
4. Shfaqja e rezultateve (summary, quiz, 7 lojëra) (30 sek)
5. Demonstrimi i 2 lojërave (Escape Room + Scenario Debate) (45 sek)
6. Profili dhe historia (30 sek)

## 3. Pjesët teknike
**Arkitektura:** React/Vite → Node.js/Express → Groq API → 7 lojëra → SQLite/Supabase

**Edge cases (6):** input bosh, tekst i gjatë, double submit, API failure, sesion i pa-autentifikuar, rate limit

**Përmirësimet:** 3→7 lojëra, shtimi i profileve, historisë dhe progresit, loading me 6 hapa

## 4. Pre-flight check
- 1 orë para: Live URL, backend, API, database, edge cases, responsive
- 5 minuta para: rifresko, krijo llogari, ngarko PDF, gjenero, testo 1 lojë, verifiko historinë

## 5. Plani B
| Skenari | Zgjidhja |
|---------|----------|
| Interneti nuk punon | Video 60 sekonda + screenshot-e |
| API rate limit | Pres 30 sekonda ose mock response |
| Backend i bie | Demo offline (versioni pa backend) |
| Laptopi crash | GitHub Codespaces |

## 6. Kohëmatësi
Hyrja: 1 min | Demo: 4 min | Teknike: 1.5 min | Plani B: 30 sek | Pyetje: 1 min

## 7. Pyetje të pritshme
- Pse 7 lojëra? Materialet e ndryshme kërkojnë lojëra të ndryshme.
- Si ruhen të dhënat? SQLite (prototip), Supabase (cloud).
- A janë të sigurta fjalëkalimet? Po, bcrypt hashing.
- Sa kushton hosting? Falas.
- Çfarë do të shtonit më tej? Autentifikim social, export PDF, më shumë lojëra.

## 8. Përfundimi
StudyForge e bën mësimin efektiv dhe argëtues përmes profilizimit, historisë dhe 7 lojërave adaptive.

*Përgatitur nga: Ermir Gerguri (@EriiGerii)*
