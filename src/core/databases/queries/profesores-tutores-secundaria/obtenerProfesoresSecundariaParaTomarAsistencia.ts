import { DURACION_HORA_ACADEMICA_EN_MINUTOS } from "../../../../constants/DURACION_HORA_ACADEMICA_EN_MINUTOS";
import { ProfesorTutorSecundariaParaTomaDeAsistencia } from "../../../../interfaces/shared/Asistencia/DatosAsistenciaHoyIE20935";
import { query } from "../../connectors/postgres";

/**
 * Calcula el horario considerando los recreos
 * @param horaBaseDate - Hora base desde donde se calcula
 * @param indice - Índice del bloque (1-7)
 * @param bloqueInicioRecreo - Bloque después del cual comienza el recreo
 * @param duracionRecreoMinutos - Duración del recreo en minutos
 * @param duracionHoraAcademicaMinutos - Duración de cada bloque académico
 * @param esHoraSalida - Indica si estamos calculando hora de salida (fin de bloque)
 * @returns Date con la hora calculada
 */
function calcularHoraConRecreo(
  horaBaseDate: Date,
  indice: number,
  bloqueInicioRecreo: number,
  duracionRecreoMinutos: number,
  duracionHoraAcademicaMinutos: number,
  esHoraSalida: boolean = false
): Date {
  // Validar índice para asegurarnos que está dentro del rango permitido (1-7)
  const indiceValido = Math.max(1, Math.min(indice, 7));
  
  const resultado = new Date(horaBaseDate);

  // Determinar cuántos minutos adicionar considerando el recreo
  let minutosAdicionales = 0;

  if (indiceValido <= bloqueInicioRecreo) {
    // Para bloques antes o igual al bloque de recreo
    minutosAdicionales = (indiceValido - 1) * duracionHoraAcademicaMinutos;

    // Si es hora de salida, añadir la duración del bloque para obtener la hora de finalización
    if (esHoraSalida) {
      minutosAdicionales += duracionHoraAcademicaMinutos;
    }
  } else {
    // Para bloques después del recreo
    minutosAdicionales =
      (indiceValido - 1) * duracionHoraAcademicaMinutos + duracionRecreoMinutos;

    // Si es hora de salida, añadir la duración del bloque para obtener la hora de finalización
    if (esHoraSalida) {
      minutosAdicionales += duracionHoraAcademicaMinutos;
    }
  }

  // Extraer horas y minutos de la hora base
  const horaBase = horaBaseDate.getHours();
  const minutosBase = horaBaseDate.getMinutes();

  // Calcular nueva hora y minutos
  const totalMinutos = minutosBase + minutosAdicionales;
  const nuevosMinutos = totalMinutos % 60;
  const horasAdicionales = Math.floor(totalMinutos / 60);
  const nuevaHora = horaBase + horasAdicionales;

  // Configurar el resultado
  resultado.setHours(nuevaHora, nuevosMinutos, 0, 0);

  return resultado;
}

/**
 * Obtiene la lista de profesores de secundaria para tomar asistencia en una fecha específica
 * @param fecha - Fecha para la que se buscan los profesores
 * @returns Lista de profesores con sus horarios calculados para el día
 */
export async function obtenerProfesoresSecundariaParaTomarAsistencia(
  fecha: Date
): Promise<ProfesorTutorSecundariaParaTomaDeAsistencia[]> {
  try {
    // Obtener el día de la semana (0-6, 0 siendo domingo)
    const diaSemana = fecha.getDay();
    // Convertir a formato usado en la base de datos (1-7, 1 siendo lunes)
    const diaSemanaDB = diaSemana === 0 ? 7 : diaSemana;

    // 1. Obtener los ajustes del sistema para el recreo
    const ajustesQuery = `
      SELECT "Nombre", "Valor" 
      FROM "T_Ajustes_Generales_Sistema" 
      WHERE "Nombre" IN ('BLOQUE_INICIO_RECREO_SECUNDARIA', 'DURACION_RECREO_SECUNDARIA_MINUTOS')
    `;
    const ajustesResult = await query(ajustesQuery);

    // Extraer valores de los ajustes
    const ajustes = ajustesResult.rows.reduce((acc: any, row: any) => {
      acc[row.Nombre] = parseInt(row.Valor, 10);
      return acc;
    }, {});

    const bloqueInicioRecreo = ajustes.BLOQUE_INICIO_RECREO_SECUNDARIA || 4;
    const duracionRecreoMinutos =
      ajustes.DURACION_RECREO_SECUNDARIA_MINUTOS || 15;

    // 2. Obtener la hora de inicio del horario escolar secundaria
    const horariosQuery = `
      SELECT "Valor" 
      FROM "T_Horarios_Asistencia" 
      WHERE "Nombre" = 'Hora_Inicio_Asistencia_Secundaria'
    `;
    const horariosResult = await query(horariosQuery);

    // Extraer la hora de inicio como objeto Date
    const horaInicioStr = horariosResult.rows[0]?.Valor || "13:00:00";
    let horaInicio: Date;

    // Si la Valor es un objeto Date en la DB, usamos eso, sino parseamos el string
    if (horaInicioStr instanceof Date) {
      horaInicio = new Date(fecha);
      horaInicio.setHours(
        horaInicioStr.getHours(),
        horaInicioStr.getMinutes(),
        0,
        0
      );
    } else {
      // Asumimos que viene como string en formato HH:MM:SS
      const [horaStr, minutosStr] = horaInicioStr.split(":");
      horaInicio = new Date(fecha);
      horaInicio.setHours(
        parseInt(horaStr, 10),
        parseInt(minutosStr, 10),
        0,
        0
      );
    }

    // 3. Obtener los profesores y sus horarios
    const profesoresQuery = `
      SELECT 
        ps."DNI_Profesor_Secundaria", 
        ps."Nombres", 
        ps."Apellidos", 
        ps."Genero", 
        ps."Google_Drive_Foto_ID",
        -- Obtener los horarios según los cursos asignados para este día
        MIN(ch."Indice_Hora_Academica_Inicio") as "Indice_Entrada",
        MAX(ch."Indice_Hora_Academica_Inicio" + ch."Cant_Hora_Academicas") as "Indice_Salida"
      FROM "T_Profesores_Secundaria" ps
      JOIN "T_Cursos_Horario" ch ON ps."DNI_Profesor_Secundaria" = ch."DNI_Profesor_Secundaria"
      WHERE ps."Estado" = true AND ch."Dia_Semana" = $1
      GROUP BY ps."DNI_Profesor_Secundaria", ps."Nombres", ps."Apellidos", ps."Genero", ps."Google_Drive_Foto_ID"
    `;
    const profesoresResult = await query(profesoresQuery, [diaSemanaDB]);

    // 4. Convertir resultados a objetos con horarios calculados
    return profesoresResult.rows.map((profesor: any) => {
      // Calcular hora de entrada
      const horaEntrada = calcularHoraConRecreo(
        horaInicio,
        profesor.Indice_Entrada,
        bloqueInicioRecreo,
        duracionRecreoMinutos,
        DURACION_HORA_ACADEMICA_EN_MINUTOS,
        false // No es hora de salida
      );

      // Utilizamos el enfoque de índice efectivo: el "Indice_Salida" de la BD
      // representa el índice del siguiente bloque después del último impartido,
      // por lo que restamos 1 para obtener el índice del último bloque efectivo
      const indiceSalidaEfectivo = profesor.Indice_Salida - 1;
      
      // Calculamos la hora de salida como el final de ese bloque efectivo
      const horaSalida = calcularHoraConRecreo(
        horaInicio,
        indiceSalidaEfectivo,
        bloqueInicioRecreo,
        duracionRecreoMinutos,
        DURACION_HORA_ACADEMICA_EN_MINUTOS,
        true // Es hora de salida (final del bloque)
      );

      return {
        DNI_Profesor_Secundaria: profesor.DNI_Profesor_Secundaria,
        Nombres: profesor.Nombres,
        Apellidos: profesor.Apellidos,
        Genero: profesor.Genero,
        Google_Drive_Foto_ID: profesor.Google_Drive_Foto_ID,
        Hora_Entrada_Dia_Actual: horaEntrada,
        Hora_Salida_Dia_Actual: horaSalida,
      };
    });
  } catch (error) {
    console.error("Error al obtener profesores secundaria:", error);
    throw error;
  }
}