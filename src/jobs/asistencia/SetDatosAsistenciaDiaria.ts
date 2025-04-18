import { DatosAsistenciaHoyIE20935 } from "../../interfaces/shared/Asistencia/DatosAsistenciaHoyIE20935";

import { verificarDiaEvento } from "../../core/databases/queries/eventos/verificarDiaEvento";

import { obtenerComunicadosActivos } from "../../core/databases/queries/comunicados/obtenerComunicadosActivos";
import { obtenerPersonalAdministrativoParaTomarAsistencia } from "../../core/databases/queries/personal-administrativo/obtenerPersonalAdministrativoParaTomarAsistencia";
import { obtenerProfesoresPrimariaParaTomarAsistencia } from "../../core/databases/queries/profesores-primaria/obtenerProfesoresPrimariaParaTomarAsistencia";
import { obtenerProfesoresSecundariaParaTomarAsistencia } from "../../core/databases/queries/profesores-tutores-secundaria/obtenerProfesoresSecundariaParaTomarAsistencia";
import { obtenerHorariosGenerales } from "../../core/databases/queries/horarios/obtenerHorariosGenerales";
import { obtenerHorariosEscolares } from "../../core/databases/queries/horarios/obtenerHorariosEscolares";
import { guardarDatosAsistenciaEnBlobs } from "../../core/external/vercel/blobs/guardarDatosAsistenciaEnBlobs";
import { obtenerFechasActuales } from "../../core/utils/dates/obtenerFechasActuales";
import { obtenerFechasAñoEscolar } from "../../core/databases/queries/fechas-importantes/obtenerFechasAñoEscolar";
import { verificarDentroVacacionesMedioAño } from "../../core/utils/verificators/verificarFueraVacacionesMedioAño";
import { closePool } from "../../core/databases/connectors/postgres";
import verificarFueraAñoEscolar from "../../core/utils/verificators/verificarDentroAñoEscolar";
import { obtenerAuxiliaresParaTomarAsistencia } from "../../core/databases/queries/auxiliares/obtenerAuxiliares";

async function generarDatosAsistenciaDiaria(): Promise<DatosAsistenciaHoyIE20935> {
  // Obtener fechas actuales
  const { fechaUTC, fechaLocalPeru } = obtenerFechasActuales();

  // Verificar si es día de evento
  const esDiaEvento = await verificarDiaEvento(fechaLocalPeru);

  // Obtener fechas del año escolar
  const fechasAñoEscolar = await obtenerFechasAñoEscolar();

  // Verificar si estamos dentro del año escolar y fuera de vacaciones
  const fueraAñoEscolar = verificarFueraAñoEscolar(
    fechaLocalPeru,
    fechasAñoEscolar.Fecha_Inicio_Año_Escolar,
    fechasAñoEscolar.Fecha_Fin_Año_Escolar
  );

  const dentroVacacionesMedioAño = verificarDentroVacacionesMedioAño(
    fechaLocalPeru,
    fechasAñoEscolar.Fecha_Inicio_Vacaciones_Medio_Año,
    fechasAñoEscolar.Fecha_Fin_Vacaciones_Medio_Año
  );
  // Obtener comunicados activos para hoy
  const comunicados = await obtenerComunicadosActivos(fechaLocalPeru);

  // Obtener listas de personal
  const personalAdministrativo =
    await obtenerPersonalAdministrativoParaTomarAsistencia();

  const profesoresPrimaria =
    await obtenerProfesoresPrimariaParaTomarAsistencia();
  const profesoresSecundaria =
    await obtenerProfesoresSecundariaParaTomarAsistencia(fechaLocalPeru);

  const auxiliares = await obtenerAuxiliaresParaTomarAsistencia();

  // Obtener configuraciones de horarios
  const horariosGenerales = await obtenerHorariosGenerales();
  const horariosEscolares = await obtenerHorariosEscolares();

  // Construir el objeto de datos
  const datosAsistencia: DatosAsistenciaHoyIE20935 = {
    DiaEvento: esDiaEvento,
    FechaUTC: fechaUTC,
    FechaLocalPeru: fechaLocalPeru,
    FueraAñoEscolar: fueraAñoEscolar,
    DentroVacionesMedioAño: dentroVacacionesMedioAño,
    ComunicadosParaMostrarHoy: comunicados,
    ListaDeAuxiliares: auxiliares,
    ListaDePersonalesAdministrativos: personalAdministrativo,
    ListaDeProfesoresPrimaria: profesoresPrimaria,
    ListaDeProfesoresSecundaria: profesoresSecundaria,
    HorariosLaboraresGenerales: horariosGenerales,
    HorariosEscolares: horariosEscolares,
  };

  return datosAsistencia;
}

async function main() {
  try {
    console.log("Iniciando generación de datos de asistencia diaria...");

    const datosAsistencia = await generarDatosAsistenciaDiaria();

    // Guardar datos en Vercel Blob
    await guardarDatosAsistenciaEnBlobs(datosAsistencia);

    // Imprimir en consola para verificación
    console.log(JSON.stringify(datosAsistencia, null, 2));

    console.log("Datos de asistencia generados y guardados correctamente.");
  } catch (error) {
    console.error("Error al generar datos de asistencia:", error);
    process.exit(1); // Terminar con código de error
  } finally {
    await closePool();
    console.log("Conexiones cerradas. Finalizando proceso...");
    process.exit(0); // Terminar con código de éxito
  }
}

main();
