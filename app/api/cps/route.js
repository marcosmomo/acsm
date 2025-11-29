import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // pasta: <raiz do projeto>/cps-defs
    const dir = path.join(process.cwd(), 'cps-defs');

    // se a pasta não existir, dá erro
    if (!fs.existsSync(dir)) {
      throw new Error(`Pasta não encontrada: ${dir}`);
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    const cpsList = files.map((file) => {
      const fullPath = path.join(dir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content);
    });

    return NextResponse.json({ cps: cpsList });
  } catch (e) {
    console.error('Erro ao carregar CPS JSONs:', e);
    return NextResponse.json(
      { error: `Erro ao carregar CPS JSONs: ${e.message || e}` },
      { status: 500 }
    );
  }
}
