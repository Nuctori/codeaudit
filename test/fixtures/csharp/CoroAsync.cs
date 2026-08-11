// InitDeity 协程 + async 模式（C# 语义：yield/await/Task）
using System.Collections;
using System.Threading.Tasks;
using UnityEngine;

public sealed class CoroAndAsync : MonoBehaviour
{
    IEnumerator MoveCoroutine()
    {
        yield return new WaitForSeconds(1f);
        Debug.Log("moved");
        yield return null;
    }

    async Task FetchAsync()
    {
        await Task.Delay(100);
        Debug.Log("fetched");
    }

    void Start()
    {
        StartCoroutine(MoveCoroutine());
        _ = FetchAsync();
    }

    public int PureCalc(int a, int b)
    {
        return Math.Max(a, b);
    }
}
