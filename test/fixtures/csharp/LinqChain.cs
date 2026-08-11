// InitDeity LINQ 链（动态 receiver——诚实 ? 锁定）
using System.Collections.Generic;
using System.Linq;

public sealed class LinqChain
{
    public int Compute(List<int> xs)
    {
        return xs.Where(x => x > 0).Select(x => x * 2).Sum();
    }

    public List<int> FilterAndSort(List<int> xs)
    {
        return xs.Where(x => x > 0).OrderBy(x => x).ToList();
    }

    public string JoinNames(List<string> names)
    {
        return string.Join(", ", names.ToArray());
    }
}
