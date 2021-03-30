declare module 'box-intersect' {
  function boxIntersect(
    boxes: Array<Array<number>>,
    otherBoxes?: Array<Array<number>>
  ): Array<number>;

  function boxIntersect<VisitReturnType>(
    boxes: Array<Array<number>>,
    visit: (i: number, j: number) => VisitReturnType
  ): VisitReturnType | undefined;

  function boxIntersect<VisitReturnType>(
    boxes: Array<Array<number>>,
    otherBoxes: Array<Array<number>>,
    visit: (i: number, j: number) => VisitReturnType
  ): VisitReturnType | undefined;

  export = boxIntersect;
}
